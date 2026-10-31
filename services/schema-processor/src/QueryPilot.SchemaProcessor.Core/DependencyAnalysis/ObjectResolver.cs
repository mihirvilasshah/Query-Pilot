using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.DependencyAnalysis;

public sealed record Resolution(SchemaObject? Target, string? Note);

/// <summary>Case-insensitive name resolution against the objects of one import.</summary>
public sealed class ObjectResolver
{
    public static readonly string[] Relations = [ObjectTypes.Table, ObjectTypes.View, ObjectTypes.Synonym];
    public static readonly string[] Procedures = [ObjectTypes.Procedure, ObjectTypes.Synonym];
    public static readonly string[] Functions = [ObjectTypes.Function, ObjectTypes.Synonym];
    public static readonly string[] Referenceable =
        [ObjectTypes.Sequence, ObjectTypes.Table, ObjectTypes.View, ObjectTypes.Synonym, ObjectTypes.Type];
    public static readonly string[] Any =
        [ObjectTypes.Table, ObjectTypes.View, ObjectTypes.Procedure, ObjectTypes.Function, ObjectTypes.Sequence,
         ObjectTypes.Synonym, ObjectTypes.Type];

    private const string NotFound = "not found in imported schema";

    private readonly ExtractedSchema _schema;
    private readonly Dictionary<string, List<SchemaObject>> _byName = new(StringComparer.OrdinalIgnoreCase);

    public ObjectResolver(ExtractedSchema schema)
    {
        _schema = schema;
        foreach (var o in schema.Objects)
        {
            if (o.ObjectType is ObjectTypes.Schema or ObjectTypes.Trigger or ObjectTypes.Other)
            {
                continue;
            }

            if (!_byName.TryGetValue(o.Name, out var list))
            {
                _byName[o.Name] = list = [];
            }

            list.Add(o);
        }
    }

    public Resolution Resolve(RawName name, string[] preferredTypes)
    {
        if (name.Server is not null || (name.Database is not null && !IsLocalDatabase(name.Database)))
        {
            var where = name.Server is not null ? $"linked server '{name.Server}'" : $"external database '{name.Database}'";
            return new Resolution(null, $"{NotFound} ({where})");
        }

        _byName.TryGetValue(name.Name, out var candidates);
        candidates ??= [];

        if (name.Schema is not null)
        {
            var match = Pick(candidates.Where(c => c.SchemaName.Equals(name.Schema, StringComparison.OrdinalIgnoreCase)), preferredTypes);
            return match is null ? new Resolution(null, NotFound) : new Resolution(match, null);
        }

        var dbo = Pick(candidates.Where(c => c.SchemaName.Equals("dbo", StringComparison.OrdinalIgnoreCase)), preferredTypes);
        if (dbo is not null)
        {
            return new Resolution(dbo, null);
        }

        var typed = candidates.Where(c => preferredTypes.Contains(c.ObjectType)).ToList();
        if (typed.Count == 1)
        {
            return new Resolution(typed[0], null);
        }

        if (typed.Count > 1)
        {
            var schemas = string.Join(", ", typed.Select(t => t.SchemaName).Distinct(StringComparer.OrdinalIgnoreCase).Order());
            return new Resolution(null, $"{NotFound} (unqualified name is ambiguous; matches objects in schemas: {schemas})");
        }

        return new Resolution(null, NotFound);
    }

    private bool IsLocalDatabase(string? database) =>
        database is not null && _schema.DatabaseName is not null &&
        database.Equals(_schema.DatabaseName, StringComparison.OrdinalIgnoreCase);

    private static SchemaObject? Pick(IEnumerable<SchemaObject> candidates, string[] preferredTypes)
    {
        var list = candidates.ToList();
        foreach (var type in preferredTypes)
        {
            var hit = list.FirstOrDefault(c => c.ObjectType == type);
            if (hit is not null)
            {
                return hit;
            }
        }

        return null;
    }
}
