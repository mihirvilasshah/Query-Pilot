using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.DependencyAnalysis;

/// <summary>
/// Turns the raw per-object facts into the normalized relationship / dependency rows:
/// declared and (strictly) inferred relationships, reads/writes/executes/calls, trigger links,
/// and DacFx confirmation. Pure in-memory; no I/O.
/// </summary>
public static class SchemaAnalyzer
{
    public const string InferenceOrigin = "name-based inference";

    public static void Analyze(ExtractedSchema schema)
    {
        var resolver = new ObjectResolver(schema);
        var explicitOrigin = schema.SourceType == "dacpac" ? DependencyOrigins.DacFx : DependencyOrigins.ScriptDom;

        schema.Relationships.Clear();
        schema.Dependencies.Clear();

        LinkTriggers(schema, resolver);
        BuildDeclaredRelationships(schema, resolver);
        BuildInferredRelationships(schema);
        ApplyBodyMetadata(schema);
        BuildBodyDependencies(schema, resolver);
        BuildExplicitDependencies(schema, resolver, explicitOrigin);
        if (schema.SourceType == "dacpac")
        {
            MergeDacfx(schema, resolver);
        }

        AddLimitations(schema);
    }

    private static void LinkTriggers(ExtractedSchema schema, ObjectResolver resolver)
    {
        foreach (var trigger in schema.Objects.Where(o => o.ObjectType == ObjectTypes.Trigger))
        {
            if (trigger.Metadata.TriggerParent is not { } parent)
            {
                continue;
            }

            var resolved = resolver.Resolve(new RawName(null, null, parent.Schema, parent.Name),
                [ObjectTypes.Table, ObjectTypes.View]);
            trigger.ParentObjectId = resolved.Target?.Id;
        }
    }

    private static void BuildDeclaredRelationships(ExtractedSchema schema, ObjectResolver resolver)
    {
        foreach (var table in schema.Objects.Where(o => o.ObjectType == ObjectTypes.Table))
        {
            foreach (var fk in table.ForeignKeys)
            {
                var resolved = resolver.Resolve(new RawName(null, null, fk.TargetSchema, fk.TargetName),
                    [ObjectTypes.Table]);
                var target = resolved.Target;
                var targetColumns = fk.TargetColumns.Count > 0
                    ? fk.TargetColumns
                    : target?.Constraints.FirstOrDefault(c => c.ConstraintType == ConstraintTypes.PrimaryKey)?.Columns ?? [];

                schema.Relationships.Add(new RelationshipInfo
                {
                    Kind = "declared",
                    Name = fk.Name,
                    SourceObjectId = table.Id,
                    TargetObjectId = target?.Id,
                    TargetSchema = target?.SchemaName ?? fk.TargetSchema,
                    TargetName = target?.Name ?? fk.TargetName,
                    SourceColumns = [.. fk.SourceColumns],
                    TargetColumns = [.. targetColumns],
                    OnDelete = fk.OnDelete,
                    OnUpdate = fk.OnUpdate,
                    Origin = schema.SourceType == "dacpac" ? "dacpac foreign key" : "sql foreign key",
                });
            }
        }
    }

    /// <summary>
    /// Deliberately conservative: a column is linked only when no foreign key covers it, it is not part of its
    /// table's primary key, its name equals the single-column primary key name of exactly one other table, and the
    /// data types are identical.
    /// </summary>
    private static void BuildInferredRelationships(ExtractedSchema schema)
    {
        var tables = schema.Objects.Where(o => o.ObjectType == ObjectTypes.Table).ToList();
        var singleColumnPks = new Dictionary<string, List<(SchemaObject Table, ColumnInfo Column)>>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tables)
        {
            var pk = t.Constraints.FirstOrDefault(c => c.ConstraintType == ConstraintTypes.PrimaryKey);
            if (pk is { Columns.Count: 1 } &&
                t.Columns.FirstOrDefault(c => c.Name.Equals(pk.Columns[0], StringComparison.OrdinalIgnoreCase)) is { } col)
            {
                if (!singleColumnPks.TryGetValue(col.Name, out var list))
                {
                    singleColumnPks[col.Name] = list = [];
                }

                list.Add((t, col));
            }
        }

        foreach (var table in tables)
        {
            foreach (var col in table.Columns)
            {
                if (col.IsPrimaryKey ||
                    table.ForeignKeys.Any(f => f.SourceColumns.Contains(col.Name, StringComparer.OrdinalIgnoreCase)) ||
                    !singleColumnPks.TryGetValue(col.Name, out var owners))
                {
                    continue;
                }

                var others = owners.Where(o => o.Table != table).ToList();
                if (others.Count != 1 || !SameType(col, others[0].Column))
                {
                    continue;
                }

                var (target, targetCol) = others[0];
                schema.Relationships.Add(new RelationshipInfo
                {
                    Kind = "inferred",
                    SourceObjectId = table.Id,
                    TargetObjectId = target.Id,
                    TargetSchema = target.SchemaName,
                    TargetName = target.Name,
                    SourceColumns = [col.Name],
                    TargetColumns = [targetCol.Name],
                    Origin = InferenceOrigin,
                });
            }
        }
    }

    private static bool SameType(ColumnInfo a, ColumnInfo b) =>
        a.DataType.Equals(b.DataType, StringComparison.OrdinalIgnoreCase) &&
        a.MaxLength == b.MaxLength && a.NumericPrecision == b.NumericPrecision && a.NumericScale == b.NumericScale;

    private static void ApplyBodyMetadata(ExtractedSchema schema)
    {
        foreach (var o in schema.Objects)
        {
            if (o.Body is not { } body ||
                o.ObjectType is not (ObjectTypes.View or ObjectTypes.Procedure or ObjectTypes.Function or ObjectTypes.Trigger))
            {
                continue;
            }

            var m = o.Metadata;
            m.Operations = body.Operations;
            m.HasTransaction = body.HasTransaction;
            m.HasDynamicSql = body.DynamicSql.Count > 0;
            m.DynamicSqlCount = body.DynamicSql.Count;
            m.TemporaryTables = body.TemporaryTables.Count > 0 ? [.. body.TemporaryTables] : null;
            m.TableVariables = body.TableVariables.Count > 0 ? [.. body.TableVariables] : null;
        }
    }

    private static string[] PreferredTypes(string kind) => kind switch
    {
        DependencyKinds.Executes => ObjectResolver.Procedures,
        DependencyKinds.CallsFunction => ObjectResolver.Functions,
        DependencyKinds.References => ObjectResolver.Referenceable,
        _ => ObjectResolver.Relations,
    };

    private static string? UnresolvedType(string kind) => kind switch
    {
        DependencyKinds.Executes => ObjectTypes.Procedure,
        DependencyKinds.CallsFunction => ObjectTypes.Function,
        DependencyKinds.References => null,
        _ => null,
    };

    private static void BuildBodyDependencies(ExtractedSchema schema, ObjectResolver resolver)
    {
        foreach (var source in schema.Objects.Where(o => o.Body is not null))
        {
            var body = source.Body!;
            var rows = new Dictionary<string, DependencyInfo>(StringComparer.OrdinalIgnoreCase);

            foreach (var r in body.References)
            {
                var resolution = resolver.Resolve(r.Name, PreferredTypes(r.Kind));
                var target = resolution.Target;
                var key = target is not null
                    ? $"{r.Kind}|{target.Id}"
                    : $"{r.Kind}|?|{r.Name.Database}|{r.Name.Schema}|{r.Name.Name}";

                if (!rows.TryGetValue(key, out var row))
                {
                    row = new DependencyInfo
                    {
                        SourceObjectId = source.Id,
                        TargetObjectId = target?.Id,
                        TargetSchema = target?.SchemaName ?? r.Name.Schema,
                        TargetName = target?.Name ?? r.Name.Name,
                        TargetType = target?.ObjectType ?? UnresolvedType(r.Kind),
                        Kind = r.Kind,
                        Confidence = DependencyConfidences.ParsedReference,
                        Origin = DependencyOrigins.ScriptDom,
                        Line = r.Line,
                        Note = resolution.Note,
                    };
                    rows[key] = row;
                }

                foreach (var op in r.Operations)
                {
                    if (!row.Operations.Contains(op))
                    {
                        row.Operations.Add(op);
                    }
                }
            }

            schema.Dependencies.AddRange(rows.Values);

            foreach (var d in body.DynamicSql)
            {
                schema.Dependencies.Add(new DependencyInfo
                {
                    SourceObjectId = source.Id,
                    Kind = DependencyKinds.Executes,
                    Confidence = DependencyConfidences.UnresolvedDynamic,
                    Origin = DependencyOrigins.ScriptDom,
                    Line = d.Line,
                    Note = d.Note,
                });
            }
        }
    }

    /// <summary>Foreign keys and trigger parents are stated explicitly in DDL, so they are confirmed.</summary>
    private static void BuildExplicitDependencies(ExtractedSchema schema, ObjectResolver resolver, string origin)
    {
        foreach (var rel in schema.Relationships.Where(r => r.Kind == "declared"))
        {
            schema.Dependencies.Add(new DependencyInfo
            {
                SourceObjectId = rel.SourceObjectId,
                TargetObjectId = rel.TargetObjectId,
                TargetSchema = rel.TargetSchema,
                TargetName = rel.TargetName,
                TargetType = ObjectTypes.Table,
                Kind = DependencyKinds.References,
                Confidence = rel.TargetObjectId is null ? DependencyConfidences.ParsedReference : DependencyConfidences.ConfirmedStatic,
                Origin = rel.TargetObjectId is null ? DependencyOrigins.ScriptDom : origin,
                Note = rel.TargetObjectId is null ? "not found in imported schema" : null,
            });
        }

        foreach (var trigger in schema.Objects.Where(o => o.ObjectType == ObjectTypes.Trigger && o.Metadata.TriggerParent is not null))
        {
            var parent = trigger.Metadata.TriggerParent!;
            var resolved = trigger.ParentObjectId is { } id
                ? schema.Objects.First(o => o.Id == id)
                : null;
            schema.Dependencies.Add(new DependencyInfo
            {
                SourceObjectId = trigger.Id,
                TargetObjectId = resolved?.Id,
                TargetSchema = resolved?.SchemaName ?? parent.Schema,
                TargetName = resolved?.Name ?? parent.Name,
                TargetType = resolved?.ObjectType ?? ObjectTypes.Table,
                Kind = DependencyKinds.TriggerOn,
                Confidence = resolved is null ? DependencyConfidences.ParsedReference : DependencyConfidences.ConfirmedStatic,
                Origin = resolved is null ? DependencyOrigins.ScriptDom : origin,
                Line = trigger.SourceLine,
                Note = resolved is null ? "not found in imported schema" : null,
            });
        }
    }

    /// <summary>
    /// DacFx resolved these references against the whole model. A parsed reference that DacFx also reports becomes
    /// confirmed_static; references only DacFx saw are added (read/write mode unknown, so no operations).
    /// </summary>
    private static void MergeDacfx(ExtractedSchema schema, ObjectResolver resolver)
    {
        var bodyTypes = new[] { ObjectTypes.View, ObjectTypes.Procedure, ObjectTypes.Function, ObjectTypes.Trigger, ObjectTypes.Synonym };

        foreach (var reference in schema.DacfxReferences.Distinct())
        {
            var source = schema.Objects.FirstOrDefault(o =>
                bodyTypes.Contains(o.ObjectType) &&
                o.SchemaName.Equals(reference.SourceSchema, StringComparison.OrdinalIgnoreCase) &&
                o.Name.Equals(reference.SourceName, StringComparison.OrdinalIgnoreCase));
            var target = resolver.Resolve(new RawName(null, null, reference.TargetSchema, reference.TargetName), ObjectResolver.Any).Target;
            if (source is null || target is null)
            {
                continue;
            }

            if (reference.Kind == "TriggerObject")
            {
                continue; // already recorded (and confirmed) from the trigger definition
            }

            var isRelation = target.ObjectType is ObjectTypes.Table or ObjectTypes.View;
            var defaultKind = target.ObjectType switch
            {
                ObjectTypes.Table or ObjectTypes.View => DependencyKinds.Reads,
                ObjectTypes.Procedure => DependencyKinds.Executes,
                ObjectTypes.Function => DependencyKinds.CallsFunction,
                _ => DependencyKinds.References,
            };

            var matches = schema.Dependencies.Where(d =>
                d.SourceObjectId == source.Id && d.TargetObjectId == target.Id &&
                (isRelation ? d.Kind is DependencyKinds.Reads or DependencyKinds.Writes : d.Kind == defaultKind) &&
                d.Confidence != DependencyConfidences.UnresolvedDynamic).ToList();

            if (matches.Count == 0)
            {
                schema.Dependencies.Add(new DependencyInfo
                {
                    SourceObjectId = source.Id,
                    TargetObjectId = target.Id,
                    TargetSchema = target.SchemaName,
                    TargetName = target.Name,
                    TargetType = target.ObjectType,
                    Kind = defaultKind,
                    Confidence = DependencyConfidences.ConfirmedStatic,
                    Origin = DependencyOrigins.DacFx,
                    Note = "Reported by DacFx; access mode was not determined from the script.",
                });
                continue;
            }

            foreach (var m in matches)
            {
                m.Confidence = DependencyConfidences.ConfirmedStatic;
                m.Origin = DependencyOrigins.DacFx;
            }
        }
    }

    private static void AddLimitations(ExtractedSchema schema)
    {
        void Add(string text)
        {
            if (!schema.Limitations.Contains(text))
            {
                schema.Limitations.Add(text);
            }
        }

        Add("Dynamic SQL references are not resolved.");
        Add("Dependencies come from static analysis of definitions and may be incomplete.");
        Add("Relationships marked inferred are name-based guesses, not declared foreign keys.");
        Add("Cross-database and linked-server references are not resolved.");
        Add("Result columns of views and table-valued functions are not extracted.");
        if (schema.SourceType == "dacpac")
        {
            Add("Object definitions are regenerated from the DACPAC model and may differ in formatting from the original source files.");
        }
    }
}
