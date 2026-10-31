using System.Text.Json;
using System.Text.Json.Serialization;

namespace QueryPilot.SchemaProcessor.Models;

/// <summary>Shared JSON settings. Output must match packages/shared-types (camelCase, no null noise).</summary>
public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static readonly JsonSerializerOptions Indented = new(Options) { WriteIndented = true };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}

public static class ObjectTypes
{
    public const string Schema = "schema";
    public const string Table = "table";
    public const string View = "view";
    public const string Procedure = "procedure";
    public const string Function = "function";
    public const string Trigger = "trigger";
    public const string Sequence = "sequence";
    public const string Type = "type";
    public const string Synonym = "synonym";
    public const string Other = "other";
}

public static class DependencyKinds
{
    public const string Reads = "reads";
    public const string Writes = "writes";
    public const string Executes = "executes";
    public const string CallsFunction = "calls_function";
    public const string References = "references";
    public const string TriggerOn = "trigger_on";
}

public static class DependencyConfidences
{
    public const string ConfirmedStatic = "confirmed_static";
    public const string ParsedReference = "parsed_reference";
    public const string Inferred = "inferred";
    public const string UnresolvedDynamic = "unresolved_dynamic";
}

public static class DependencyOrigins
{
    public const string DacFx = "dacfx";
    public const string ScriptDom = "scriptdom";
}

public static class WarningCodes
{
    public const string ParseError = "PARSE_ERROR";
    public const string UnsupportedStatement = "UNSUPPORTED_STATEMENT";
    public const string UnsupportedObject = "UNSUPPORTED_OBJECT";
    public const string DuplicateDefinition = "DUPLICATE_DEFINITION";
    public const string UnresolvedTarget = "UNRESOLVED_TARGET";
    public const string AlterWithoutCreate = "ALTER_WITHOUT_CREATE";
    public const string NoSchemaObjects = "NO_SCHEMA_OBJECTS";
    public const string TooManyWarnings = "TOO_MANY_WARNINGS";
    public const string SourceEncoding = "SOURCE_ENCODING";
}

public sealed record ImportWarning(
    string Code,
    string Message,
    string? ObjectName = null,
    string? File = null,
    int? Line = null);

public sealed class UnsupportedObjectCount
{
    public string ObjectType { get; set; } = "";
    public int Count { get; set; }
}

public sealed class SummaryCounts
{
    public int Schemas { get; set; }
    public int Tables { get; set; }
    public int Views { get; set; }
    public int Procedures { get; set; }
    public int Functions { get; set; }
    public int Triggers { get; set; }
    public int Indexes { get; set; }
    public int ForeignKeys { get; set; }
    public int Columns { get; set; }
    public int Dependencies { get; set; }
}

/// <summary>Mirrors <c>ImportSummary</c> in packages/shared-types.</summary>
public sealed class ImportSummary
{
    public string SourceType { get; set; } = "";
    public string? DatabaseName { get; set; }
    public SummaryCounts Counts { get; set; } = new();
    public List<UnsupportedObjectCount> Unsupported { get; set; } = [];
    public List<ImportWarning> Warnings { get; set; } = [];
    public List<string> Limitations { get; set; } = [];
}

public sealed class ParameterMetadata
{
    public string Name { get; set; } = "";
    public string DataType { get; set; } = "";
    public string Direction { get; set; } = "in";
    public bool? HasDefault { get; set; }
    public string? DefaultValue { get; set; }
}

public sealed class TriggerParent
{
    public string Schema { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class OperationCounts
{
    public int Select { get; set; }
    public int Insert { get; set; }
    public int Update { get; set; }
    public int Delete { get; set; }
    public int Merge { get; set; }
}

/// <summary>Mirrors <c>ObjectMetadata</c> in packages/shared-types (stored in database_objects.metadata).</summary>
public sealed class ObjectMetadata
{
    public List<ParameterMetadata>? Parameters { get; set; }
    public string? ReturnType { get; set; }
    public string? FunctionType { get; set; }
    public List<string>? TriggerEvents { get; set; }
    public string? TriggerTiming { get; set; }
    public TriggerParent? TriggerParent { get; set; }
    public List<string>? TemporaryTables { get; set; }
    public List<string>? TableVariables { get; set; }
    public bool? HasTransaction { get; set; }
    public OperationCounts? Operations { get; set; }
    public bool? HasDynamicSql { get; set; }
    public int? DynamicSqlCount { get; set; }
    public bool? IsSchemaBound { get; set; }
}
