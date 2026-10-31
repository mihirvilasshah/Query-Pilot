using Microsoft.SqlServer.Dac;
using Microsoft.SqlServer.Dac.Model;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Models;
using QueryPilot.SchemaProcessor.SqlParser;

namespace QueryPilot.SchemaProcessor.Dacpac;

/// <summary>
/// Extracts schema metadata from a .dacpac by loading its model with DacFx (offline; no database connection)
/// and feeding each top-level object's script through the same ScriptDom pipeline used for .sql files.
/// </summary>
public sealed class DacpacExtractor
{
    // Elements that are fully described by their parent table/view/routine script.
    private static readonly HashSet<string> Subsumed = new(StringComparer.Ordinal)
    {
        "Column", "Parameter", "PrimaryKeyConstraint", "UniqueConstraint", "ForeignKeyConstraint",
        "CheckConstraint", "DefaultConstraint", "TableTypeColumn", "TableTypeCheckConstraint",
        "TableTypeDefaultConstraint", "TableTypeIndex", "TableTypePrimaryKeyConstraint",
        "TableTypeUniqueConstraint", "EdgeConstraint",
        // Database-level settings exist in every package and are not schema objects.
        "DatabaseOptions",
    };

    private static readonly HashSet<string> BodyTypes = new(StringComparer.Ordinal)
    {
        "View", "Procedure", "ScalarFunction", "TableValuedFunction", "DmlTrigger", "Synonym",
    };

    private static readonly HashSet<string> ReferenceableTargets = new(StringComparer.Ordinal)
    {
        "Table", "FileTable", "View", "Procedure", "ScalarFunction", "TableValuedFunction", "Synonym", "Sequence",
    };

    private static readonly HashSet<string> ReferenceRelationships = new(StringComparer.Ordinal)
    {
        "BodyDependencies", "ForObject", "TriggerObject",
    };

    /// <summary>Scripted element type → emit order (parents before children; indexes last).</summary>
    private static readonly Dictionary<string, int> Scripted = new(StringComparer.Ordinal)
    {
        ["Schema"] = 0,
        ["DataType"] = 1, ["UserDefinedType"] = 1, ["TableType"] = 1,
        ["Table"] = 2, ["FileTable"] = 2,
        ["Sequence"] = 3, ["Synonym"] = 3, ["View"] = 3, ["Procedure"] = 3,
        ["ScalarFunction"] = 3, ["TableValuedFunction"] = 3, ["DmlTrigger"] = 3,
        ["Index"] = 4, ["ColumnStoreIndex"] = 4,
    };

    public ExtractedSchema Extract(string fileName, byte[] content, ExtractionLimits limits, CancellationToken cancellationToken = default) =>
        Extract(fileName, content, DacpacValidator.Validate(content, limits), cancellationToken);

    public ExtractedSchema Extract(string fileName, byte[] content, DacpacInfo info, CancellationToken cancellationToken = default)
    {
        TSqlModel model;
        try
        {
            using var stream = new MemoryStream(content, writable: false);
            model = TSqlModel.LoadFromDacpac(stream, new ModelLoadOptions(DacSchemaModelStorageType.Memory, loadAsScriptBackedModel: true), cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new ImportException(ErrorCodes.InvalidDacpac,
                "The .dacpac model could not be read. The package may be corrupt or built for an unsupported SQL Server version.");
        }

        using (model)
        {
            return Build(fileName, info, model);
        }
    }

    private static ExtractedSchema Build(string fileName, DacpacInfo info, TSqlModel model)
    {
        var warnings = new WarningCollector();
        var schema = new ExtractedSchema { SourceType = "dacpac", FileName = fileName, DatabaseName = info.DatabaseName };
        var builder = new SchemaBuilder(schema, warnings);
        var parser = new TSql170Parser(initialQuotedIdentifiers: true);
        var unsupported = new Dictionary<string, int>(StringComparer.Ordinal);

        var all = model.GetObjects(DacQueryScopes.UserDefined).ToList();
        var scripted = new List<(TSqlObject Object, int Order)>();
        foreach (var o in all)
        {
            var type = o.ObjectType.Name;
            if (Scripted.TryGetValue(type, out var order))
            {
                scripted.Add((o, order));
            }
            else if (!Subsumed.Contains(type))
            {
                unsupported[type] = unsupported.GetValueOrDefault(type) + 1;
            }
        }

        foreach (var (obj, _) in scripted.OrderBy(s => s.Order).ThenBy(s => s.Object.Name.ToString(), StringComparer.Ordinal))
        {
            if (!obj.TryGetScript(out var script) || string.IsNullOrWhiteSpace(script))
            {
                warnings.Add(WarningCodes.UnsupportedObject,
                    $"The script for {obj.ObjectType.Name} {obj.Name} is not available; it was not imported.", obj.Name.ToString());
                unsupported[obj.ObjectType.Name] = unsupported.GetValueOrDefault(obj.ObjectType.Name) + 1;
                continue;
            }

            var source = obj.GetSourceInformation();
            var hasFile = source?.SourceName is { } sn && (sn.Contains(".sql", StringComparison.OrdinalIgnoreCase) || sn.Contains('\\') || sn.Contains('/'));
            var ctx = new StatementContext(
                script,
                hasFile ? source!.SourceName : null,
                hasFile && source!.StartLine > 0 ? source.StartLine - 1 : null);

            using var reader = new StringReader(script);
            var fragment = parser.Parse(reader, out var errors);
            if (errors.Count > 0)
            {
                var e = errors[0];
                warnings.Add(WarningCodes.ParseError,
                    $"The script of {obj.ObjectType.Name} {obj.Name} could not be parsed (line {e.Line}, column {e.Column}): {e.Message}",
                    obj.Name.ToString(), ctx.File, null);
                continue;
            }

            foreach (var statement in ((TSqlScript)fragment).Batches.SelectMany(b => b.Statements))
            {
                builder.Apply(statement, ctx);
            }

            if (BodyTypes.Contains(obj.ObjectType.Name))
            {
                CollectReferences(schema, obj);
            }
        }

        foreach (var (type, count) in unsupported.OrderBy(k => k.Key, StringComparer.Ordinal))
        {
            schema.Unsupported[type] = count;
            warnings.Add(WarningCodes.UnsupportedObject,
                $"{count} object(s) of type '{type}' are not supported and were not imported.", type);
        }

        schema.Warnings.AddRange(warnings.Finish());
        return schema;
    }

    private static void CollectReferences(ExtractedSchema schema, TSqlObject obj)
    {
        var parts = obj.Name.Parts;
        if (parts.Count != 2)
        {
            return;
        }

        foreach (var r in obj.GetReferencedRelationshipInstances(DacQueryScopes.UserDefined))
        {
            var target = r.Object;
            if (target is null ||
                !ReferenceRelationships.Contains(r.Relationship.Name) ||
                !ReferenceableTargets.Contains(target.ObjectType.Name) ||
                target.Name.Parts.Count != 2)
            {
                continue;
            }

            schema.DacfxReferences.Add(new DacfxReference(
                parts[0], parts[1], target.Name.Parts[0], target.Name.Parts[1], r.Relationship.Name));
        }
    }
}
