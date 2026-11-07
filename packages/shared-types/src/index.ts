export type DatabasePlatform =
  | "sqlserver"
  | "azure_sql_database"
  | "azure_sql_managed_instance"
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "other";

export const DATABASE_PLATFORMS: { value: DatabasePlatform; label: string }[] = [
  { value: "sqlserver", label: "SQL Server" },
  { value: "azure_sql_managed_instance", label: "Azure SQL Managed Instance" },
  { value: "azure_sql_database", label: "Azure SQL Database" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "other", label: "Other" },
];

export type SqlDialect = "tsql" | "postgresql" | "mysql" | "sqlite";

export const SQL_DIALECTS: { value: SqlDialect; label: string; monaco: string }[] = [
  { value: "tsql", label: "SQL Server / T-SQL", monaco: "sql" },
  { value: "postgresql", label: "PostgreSQL", monaco: "pgsql" },
  { value: "mysql", label: "MySQL", monaco: "mysql" },
  { value: "sqlite", label: "SQLite", monaco: "sql" },
];

export type DatabaseObjectType =
  | "schema"
  | "table"
  | "view"
  | "procedure"
  | "function"
  | "trigger"
  | "sequence"
  | "type"
  | "synonym"
  | "other";

export type ImportSourceType = "dacpac" | "sql";

export type ImportJobStatus =
  | "pending"
  | "validating"
  | "processing"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export const IMPORT_STATUS_LABELS: Record<ImportJobStatus, string> = {
  pending: "Pending",
  validating: "Validating",
  processing: "Processing",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
};

export type DependencyConfidence =
  | "confirmed_static"
  | "parsed_reference"
  | "inferred"
  | "unresolved_dynamic";

export const DEPENDENCY_CONFIDENCE_LABELS: Record<DependencyConfidence, string> = {
  confirmed_static: "Confirmed static dependency",
  parsed_reference: "Parsed reference",
  inferred: "Inferred relationship",
  unresolved_dynamic: "Unresolved dynamic reference",
};

export type DependencyKind =
  | "reads"
  | "writes"
  | "executes"
  | "calls_function"
  | "references"
  | "trigger_on";

export type RelationshipKind = "declared" | "inferred";

export interface ImportWarning {
  code: string;
  message: string;
  objectName?: string;
  file?: string;
  line?: number;
}

export interface ProcedureParameter {
  name: string;
  dataType: string;
  direction: "in" | "out" | "inout";
  hasDefault?: boolean;
  defaultValue?: string | null;
}

export interface ObjectMetadata {
  parameters?: ProcedureParameter[];
  returnType?: string | null;
  functionType?: "scalar" | "inline_table_valued" | "multi_statement_table_valued" | "unknown";
  triggerEvents?: string[];
  triggerTiming?: string | null;
  triggerParent?: { schema: string; name: string } | null;
  temporaryTables?: string[];
  tableVariables?: string[];
  hasTransaction?: boolean;
  operations?: { select: number; insert: number; update: number; delete: number; merge: number };
  hasDynamicSql?: boolean;
  dynamicSqlCount?: number;
  isSchemaBound?: boolean;
  [key: string]: unknown;
}

export interface ImportSummary {
  sourceType: ImportSourceType;
  databaseName?: string | null;
  counts: {
    schemas: number;
    tables: number;
    views: number;
    procedures: number;
    functions: number;
    triggers: number;
    indexes: number;
    foreignKeys: number;
    columns: number;
    dependencies: number;
  };
  unsupported: { objectType: string; count: number }[];
  warnings: ImportWarning[];
  limitations: string[];
}

export type QueryHistoryOperation =
  | "sql_explain"
  | "sql_generate"
  | "sql_analyze"
  | "sql_optimize"
  | "schema_comparison"
  | "ai_conversation"
  | "migration_plan"
  | "documentation";

export const OPERATION_LABELS: Record<QueryHistoryOperation, string> = {
  sql_explain: "SQL explanation",
  sql_generate: "SQL generation",
  sql_analyze: "SQL analysis",
  sql_optimize: "SQL optimization",
  schema_comparison: "Schema comparison",
  ai_conversation: "AI conversation",
  migration_plan: "Migration plan",
  documentation: "Documentation",
};

export type RiskLevel = "critical" | "high" | "medium" | "low" | "informational";

export const RISK_ORDER: RiskLevel[] = ["critical", "high", "medium", "low", "informational"];

export type AiProviderId = "gemini" | "openrouter" | "groq";
