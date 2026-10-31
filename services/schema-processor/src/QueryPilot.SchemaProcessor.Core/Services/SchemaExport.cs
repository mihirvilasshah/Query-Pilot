using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Services;

/// <summary>Human-friendly JSON projection of an extraction (ids resolved to names) for the CLI.</summary>
public static class SchemaExport
{
    public static object Build(ExtractedSchema schema)
    {
        var names = schema.Objects.ToDictionary(o => o.Id, o => o.DisplayName);
        string? NameOf(Guid? id) => id is { } g && names.TryGetValue(g, out var n) ? n : null;

        return new
        {
            summary = schema.BuildSummary(),
            objects = schema.Objects.Select(o => new
            {
                o.Id,
                o.ObjectType,
                o.SchemaName,
                o.Name,
                parent = NameOf(o.ParentObjectId),
                o.SourceFile,
                o.SourceLine,
                o.Metadata,
                o.Columns,
                o.Indexes,
                o.Constraints,
                o.Definition,
            }),
            relationships = schema.Relationships.Select(r => new
            {
                r.Kind,
                r.Name,
                source = NameOf(r.SourceObjectId),
                target = NameOf(r.TargetObjectId) ?? $"{r.TargetSchema}.{r.TargetName}",
                targetResolved = r.TargetObjectId is not null,
                r.SourceColumns,
                r.TargetColumns,
                r.OnDelete,
                r.OnUpdate,
                r.Origin,
            }),
            dependencies = schema.Dependencies.Select(d => new
            {
                source = NameOf(d.SourceObjectId),
                target = NameOf(d.TargetObjectId) ?? (d.TargetName is null ? null : $"{d.TargetSchema}.{d.TargetName}"),
                targetResolved = d.TargetObjectId is not null,
                d.TargetType,
                d.Kind,
                d.Operations,
                d.Confidence,
                d.Origin,
                d.Line,
                d.Note,
            }),
        };
    }
}
