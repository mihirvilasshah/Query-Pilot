using System.Text.Json.Serialization;
using QueryPilot.SchemaProcessor.DependencyAnalysis;

namespace QueryPilot.SchemaProcessor.Models;

public sealed class ColumnInfo
{
    public string Name { get; set; } = "";
    public int Ordinal { get; set; }
    public string DataType { get; set; } = "";
    public int? MaxLength { get; set; }
    public int? NumericPrecision { get; set; }
    public int? NumericScale { get; set; }
    public bool? IsNullable { get; set; }
    public string? DefaultValue { get; set; }
    public bool IsIdentity { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsComputed { get; set; }
    public string? ComputedExpression { get; set; }
}

public sealed class IndexKeyColumn
{
    public string Name { get; set; } = "";
    public bool? Descending { get; set; }
}

public sealed class IndexInfo
{
    public string Name { get; set; } = "";
    public string? IndexType { get; set; }
    public bool IsUnique { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsUniqueConstraint { get; set; }
    public List<IndexKeyColumn> KeyColumns { get; set; } = [];
    public List<string> IncludedColumns { get; set; } = [];
    public string? FilterDefinition { get; set; }
    public string? Definition { get; set; }
}

public static class ConstraintTypes
{
    public const string PrimaryKey = "primary_key";
    public const string Unique = "unique";
    public const string Check = "check";
    public const string Default = "default";
}

public sealed class ConstraintInfo
{
    public string? Name { get; set; }
    public string ConstraintType { get; set; } = "";
    public List<string> Columns { get; set; } = [];
    public string? Expression { get; set; }
}

/// <summary>A foreign key as declared on a table (becomes a database_relationships row, kind=declared).</summary>
public sealed class ForeignKeyInfo
{
    public string? Name { get; set; }
    public List<string> SourceColumns { get; set; } = [];
    public string TargetSchema { get; set; } = "";
    public string TargetName { get; set; } = "";
    public List<string> TargetColumns { get; set; } = [];
    public string? OnDelete { get; set; }
    public string? OnUpdate { get; set; }
}

public sealed class SchemaObject
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ObjectType { get; set; } = "";
    public string SchemaName { get; set; } = "";
    public string Name { get; set; } = "";
    public Guid? ParentObjectId { get; set; }
    public string? Definition { get; set; }
    public ObjectMetadata Metadata { get; set; } = new();
    public string? SourceFile { get; set; }
    public int? SourceLine { get; set; }
    public List<ColumnInfo> Columns { get; set; } = [];
    public List<IndexInfo> Indexes { get; set; } = [];
    public List<ConstraintInfo> Constraints { get; set; } = [];
    public List<ForeignKeyInfo> ForeignKeys { get; set; } = [];

    /// <summary>Static-analysis result for view/procedure/function/trigger/synonym bodies (not persisted).</summary>
    [JsonIgnore]
    public BodyAnalysis? Body { get; set; }
    public string DisplayName => SchemaName.Length == 0 ? Name : $"{SchemaName}.{Name}";
}

public sealed class RelationshipInfo
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Kind { get; set; } = "declared";
    public string? Name { get; set; }
    public Guid SourceObjectId { get; set; }
    public Guid? TargetObjectId { get; set; }
    public string? TargetSchema { get; set; }
    public string? TargetName { get; set; }
    public List<string> SourceColumns { get; set; } = [];
    public List<string> TargetColumns { get; set; } = [];
    public string? OnDelete { get; set; }
    public string? OnUpdate { get; set; }
    public string? Origin { get; set; }
}

public sealed class DependencyInfo
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SourceObjectId { get; set; }
    public Guid? TargetObjectId { get; set; }
    public string? TargetSchema { get; set; }
    public string? TargetName { get; set; }
    public string? TargetType { get; set; }
    public string Kind { get; set; } = "";
    public List<string> Operations { get; set; } = [];
    public string Confidence { get; set; } = "";
    public string Origin { get; set; } = "";
    public int? Line { get; set; }
    public string? Note { get; set; }
}

/// <summary>A reference DacFx reported between two top-level objects (used to confirm parsed references).</summary>
public sealed record DacfxReference(
    string SourceSchema,
    string SourceName,
    string TargetSchema,
    string TargetName,
    string Kind);

/// <summary>Everything extracted from one uploaded file; the unit that gets persisted.</summary>
public sealed class ExtractedSchema
{
    public string SourceType { get; set; } = "";
    public string? DatabaseName { get; set; }
    public string FileName { get; set; } = "";
    public List<SchemaObject> Objects { get; } = [];
    public List<RelationshipInfo> Relationships { get; } = [];
    public List<DependencyInfo> Dependencies { get; } = [];
    public List<ImportWarning> Warnings { get; } = [];
    public Dictionary<string, int> Unsupported { get; } = new(StringComparer.Ordinal);
    public List<string> Limitations { get; } = [];
    public List<DacfxReference> DacfxReferences { get; } = [];

    public ImportSummary BuildSummary()
    {
        var counts = new SummaryCounts
        {
            Schemas = Objects.Count(o => o.ObjectType == ObjectTypes.Schema),
            Tables = Objects.Count(o => o.ObjectType == ObjectTypes.Table),
            Views = Objects.Count(o => o.ObjectType == ObjectTypes.View),
            Procedures = Objects.Count(o => o.ObjectType == ObjectTypes.Procedure),
            Functions = Objects.Count(o => o.ObjectType == ObjectTypes.Function),
            Triggers = Objects.Count(o => o.ObjectType == ObjectTypes.Trigger),
            Indexes = Objects.Sum(o => o.Indexes.Count),
            ForeignKeys = Relationships.Count(r => r.Kind == "declared"),
            Columns = Objects.Sum(o => o.Columns.Count),
            Dependencies = Dependencies.Count,
        };
        return new ImportSummary
        {
            SourceType = SourceType,
            DatabaseName = DatabaseName,
            Counts = counts,
            Unsupported = Unsupported.OrderBy(k => k.Key, StringComparer.Ordinal)
                .Select(k => new UnsupportedObjectCount { ObjectType = k.Key, Count = k.Value }).ToList(),
            Warnings = [.. Warnings],
            Limitations = [.. Limitations],
        };
    }
}
