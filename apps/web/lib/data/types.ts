import type {
  DatabaseObjectType, DatabasePlatform, ImportJobStatus, ImportSourceType, ImportSummary, ImportWarning,
  QueryHistoryOperation, RiskLevel, SqlDialect,
} from "@querypilot/shared-types";

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  platform: DatabasePlatform;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  owner_id: string;
  project_id: string;
  version_number: number;
  label: string | null;
  source_type: ImportSourceType;
  source_file_name: string;
  storage_path: string | null;
  database_name: string | null;
  status: "pending" | "ready" | "ready_with_warnings" | "failed";
  summary: Partial<ImportSummary>;
  created_at: string;
  updated_at: string;
}

export interface ImportJobRow {
  id: string;
  owner_id: string;
  project_id: string;
  version_id: string;
  status: ImportJobStatus;
  stage: string | null;
  progress: number;
  file_name: string;
  file_size: number;
  file_type: ImportSourceType;
  error_code: string | null;
  error_message: string | null;
  warnings: ImportWarning[];
  attempts: number;
  max_attempts: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ObjectRow {
  id: string;
  version_id: string;
  schema_name: string;
  name: string;
  object_type: DatabaseObjectType;
  parent_object_id: string | null;
  definition: string | null;
  metadata: Record<string, unknown>;
  source_file: string | null;
  source_line: number | null;
}

export interface ColumnRow {
  id: string;
  object_id: string;
  name: string;
  ordinal: number;
  data_type: string;
  max_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: boolean | null;
  default_value: string | null;
  is_identity: boolean;
  is_primary_key: boolean;
  is_computed: boolean;
  computed_expression: string | null;
}

export interface RelationshipRow {
  id: string;
  name: string | null;
  kind: "declared" | "inferred";
  source_object_id: string;
  target_object_id: string | null;
  target_schema: string | null;
  target_name: string | null;
  source_columns: string[];
  target_columns: string[];
  on_delete: string | null;
  on_update: string | null;
}

export interface IndexRow {
  id: string;
  object_id: string;
  name: string;
  index_type: string | null;
  is_unique: boolean;
  is_primary_key: boolean;
  is_unique_constraint: boolean;
  key_columns: { name: string; descending?: boolean }[];
  included_columns: string[];
  filter_definition: string | null;
}

export interface ConstraintRow {
  id: string;
  object_id: string;
  name: string | null;
  constraint_type: "primary_key" | "unique" | "check" | "default";
  columns: string[];
  expression: string | null;
}

export interface DependencyRow {
  id: string;
  source_object_id: string;
  target_object_id: string | null;
  target_schema: string | null;
  target_name: string | null;
  target_type: string | null;
  kind: "reads" | "writes" | "executes" | "calls_function" | "references" | "trigger_on";
  operations: string[];
  confidence: "confirmed_static" | "parsed_reference" | "inferred" | "unresolved_dynamic";
  origin: string;
  line: number | null;
  note: string | null;
}

export interface ScriptRow {
  id: string;
  owner_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  content: string;
  dialect: SqlDialect;
  tags: string[];
  category: string | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScriptVersionRow {
  id: string;
  script_id: string;
  version_number: number;
  name: string;
  content: string;
  change_note: string | null;
  created_at: string;
}

export interface HistoryRow {
  id: string;
  project_id: string | null;
  operation: QueryHistoryOperation;
  title: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  ref_id: string | null;
  created_at: string;
}

export interface AnalysisRow {
  id: string;
  overall_risk: RiskLevel;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  project_id: string | null;
  version_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  structured: Record<string, unknown> | null;
  object_refs: { id: string; type: string; fullName: string }[];
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface PreferencesRow {
  user_id: string;
  theme: "light" | "dark" | "system";
  sidebar_collapsed: boolean;
  default_dialect: SqlDialect;
  ai_provider: "gemini" | "openrouter" | null;
  ai_model: string | null;
  ai_external_consent: boolean;
  ai_external_consent_at: string | null;
}

export interface ComparisonRow {
  id: string;
  project_id: string;
  base_version_id: string;
  target_version_id: string;
  summary: Record<string, unknown>;
  diff: Record<string, unknown>;
  created_at: string;
}

export interface MigrationPlanRow {
  id: string;
  project_id: string;
  comparison_id: string | null;
  source_version_id: string;
  target_version_id: string;
  title: string;
  plan: Record<string, unknown>;
  migration_sql: string;
  rollback_sql: string;
  status: "draft" | "reviewed" | "archived";
  created_at: string;
}
