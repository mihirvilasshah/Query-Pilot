/**
 * Drizzle ORM definition of the QueryPilot application database.
 *
 * Source of truth for DDL, RLS and functions is /supabase/migrations (hand-written SQL, because RLS
 * policies and storage policies are not expressible in Drizzle). This file mirrors the table shapes so
 * that row types are inferred ($inferSelect / $inferInsert) and so drizzle-kit can be used to diff schema
 * drift.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const ownerId = () => uuid("owner_id").notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userPreferences = pgTable("user_preferences", {
  id: id(),
  userId: uuid("user_id").notNull().unique(),
  theme: text("theme").notNull().default("system"),
  sidebarCollapsed: boolean("sidebar_collapsed").notNull().default(false),
  defaultDialect: text("default_dialect").notNull().default("tsql"),
  aiProvider: text("ai_provider"),
  aiModel: text("ai_model"),
  aiExternalConsent: boolean("ai_external_consent").notNull().default(false),
  aiExternalConsentAt: timestamp("ai_external_consent_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userAiCredentials = pgTable(
  "user_ai_credentials",
  {
    id: id(),
    ownerId: ownerId(),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    keyHint: text("key_hint"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.ownerId, t.provider)],
);

export const databaseProjects = pgTable(
  "database_projects",
  {
    id: id(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    description: text("description"),
    platform: text("platform").notNull().default("sqlserver"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.ownerId, t.name), index("database_projects_owner_idx").on(t.ownerId, t.updatedAt)],
);

export const databaseVersions = pgTable(
  "database_versions",
  {
    id: id(),
    ownerId: ownerId(),
    projectId: uuid("project_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    label: text("label"),
    sourceType: text("source_type").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    storagePath: text("storage_path"),
    sourceSha256: text("source_sha256"),
    databaseName: text("database_name"),
    status: text("status").notNull().default("pending"),
    summary: jsonb("summary").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.projectId, t.versionNumber)],
);

export const databaseImportJobs = pgTable("database_import_jobs", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id").notNull(),
  versionId: uuid("version_id").notNull().unique(),
  status: text("status").notNull().default("pending"),
  stage: text("stage"),
  progress: integer("progress").notNull().default(0),
  fileName: text("file_name").notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull(),
  fileType: text("file_type").notNull(),
  storagePath: text("storage_path").notNull(),
  sourceSha256: text("source_sha256"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  warnings: jsonb("warnings").notNull().default([]),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const databaseObjects = pgTable(
  "database_objects",
  {
    id: id(),
    ownerId: ownerId(),
    versionId: uuid("version_id").notNull(),
    schemaName: text("schema_name").notNull().default(""),
    name: text("name").notNull(),
    objectType: text("object_type").notNull(),
    parentObjectId: uuid("parent_object_id"),
    definition: text("definition"),
    metadata: jsonb("metadata").notNull().default({}),
    sourceFile: text("source_file"),
    sourceLine: integer("source_line"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.versionId, t.objectType, t.schemaName, t.name),
    index("database_objects_version_type_idx").on(t.versionId, t.objectType),
  ],
);

export const databaseColumns = pgTable(
  "database_columns",
  {
    id: id(),
    ownerId: ownerId(),
    versionId: uuid("version_id").notNull(),
    objectId: uuid("object_id").notNull(),
    name: text("name").notNull(),
    ordinal: integer("ordinal").notNull(),
    dataType: text("data_type").notNull(),
    maxLength: integer("max_length"),
    numericPrecision: integer("numeric_precision"),
    numericScale: integer("numeric_scale"),
    isNullable: boolean("is_nullable"),
    defaultValue: text("default_value"),
    isIdentity: boolean("is_identity").notNull().default(false),
    isPrimaryKey: boolean("is_primary_key").notNull().default(false),
    isComputed: boolean("is_computed").notNull().default(false),
    computedExpression: text("computed_expression"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.objectId, t.name)],
);

export const databaseRelationships = pgTable("database_relationships", {
  id: id(),
  ownerId: ownerId(),
  versionId: uuid("version_id").notNull(),
  name: text("name"),
  kind: text("kind").notNull().default("declared"),
  sourceObjectId: uuid("source_object_id").notNull(),
  targetObjectId: uuid("target_object_id"),
  targetSchema: text("target_schema"),
  targetName: text("target_name"),
  sourceColumns: text("source_columns").array().notNull().default([]),
  targetColumns: text("target_columns").array().notNull().default([]),
  onDelete: text("on_delete"),
  onUpdate: text("on_update"),
  origin: text("origin"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const databaseIndexes = pgTable("database_indexes", {
  id: id(),
  ownerId: ownerId(),
  versionId: uuid("version_id").notNull(),
  objectId: uuid("object_id").notNull(),
  name: text("name").notNull(),
  indexType: text("index_type"),
  isUnique: boolean("is_unique").notNull().default(false),
  isPrimaryKey: boolean("is_primary_key").notNull().default(false),
  isUniqueConstraint: boolean("is_unique_constraint").notNull().default(false),
  keyColumns: jsonb("key_columns").notNull().default([]),
  includedColumns: text("included_columns").array().notNull().default([]),
  filterDefinition: text("filter_definition"),
  definition: text("definition"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const databaseConstraints = pgTable("database_constraints", {
  id: id(),
  ownerId: ownerId(),
  versionId: uuid("version_id").notNull(),
  objectId: uuid("object_id").notNull(),
  name: text("name"),
  constraintType: text("constraint_type").notNull(),
  columns: text("columns").array().notNull().default([]),
  expression: text("expression"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const databaseDependencies = pgTable("database_dependencies", {
  id: id(),
  ownerId: ownerId(),
  versionId: uuid("version_id").notNull(),
  sourceObjectId: uuid("source_object_id").notNull(),
  targetObjectId: uuid("target_object_id"),
  targetSchema: text("target_schema"),
  targetName: text("target_name"),
  targetType: text("target_type"),
  kind: text("kind").notNull(),
  operations: text("operations").array().notNull().default([]),
  confidence: text("confidence").notNull(),
  origin: text("origin").notNull(),
  line: integer("line"),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schemaComparisons = pgTable("schema_comparisons", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id").notNull(),
  baseVersionId: uuid("base_version_id").notNull(),
  targetVersionId: uuid("target_version_id").notNull(),
  summary: jsonb("summary").notNull().default({}),
  diff: jsonb("diff").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const migrationPlans = pgTable("migration_plans", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id").notNull(),
  comparisonId: uuid("comparison_id"),
  sourceVersionId: uuid("source_version_id").notNull(),
  targetVersionId: uuid("target_version_id").notNull(),
  title: text("title").notNull(),
  plan: jsonb("plan").notNull().default({}),
  migrationSql: text("migration_sql").notNull().default(""),
  rollbackSql: text("rollback_sql").notNull().default(""),
  status: text("status").notNull().default("draft"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sqlScripts = pgTable("sql_scripts", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id"),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull().default(""),
  dialect: text("dialect").notNull().default("tsql"),
  tags: text("tags").array().notNull().default([]),
  category: text("category"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sqlScriptVersions = pgTable(
  "sql_script_versions",
  {
    id: id(),
    ownerId: ownerId(),
    scriptId: uuid("script_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    changeNote: text("change_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.scriptId, t.versionNumber)],
);

export const sqlAnalyses = pgTable("sql_analyses", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id"),
  scriptId: uuid("script_id"),
  dialect: text("dialect").notNull().default("tsql"),
  inputSql: text("input_sql").notNull(),
  overallRisk: text("overall_risk").notNull(),
  result: jsonb("result").notNull().default({}),
  aiSummary: text("ai_summary"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiConversations = pgTable("ai_conversations", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id"),
  versionId: uuid("version_id"),
  title: text("title").notNull().default("New conversation"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiMessages = pgTable("ai_messages", {
  id: id(),
  ownerId: ownerId(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  structured: jsonb("structured"),
  objectRefs: jsonb("object_refs").notNull().default([]),
  provider: text("provider"),
  model: text("model"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiRequests = pgTable("ai_requests", {
  id: id(),
  ownerId: ownerId(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const queryHistory = pgTable("query_history", {
  id: id(),
  ownerId: ownerId(),
  projectId: uuid("project_id"),
  operation: text("operation").notNull(),
  title: text("title").notNull(),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  refId: uuid("ref_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  ownerId: uuid("owner_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  details: jsonb("details").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type DatabaseProjectRow = typeof databaseProjects.$inferSelect;
export type DatabaseVersionRow = typeof databaseVersions.$inferSelect;
export type ImportJobRow = typeof databaseImportJobs.$inferSelect;
export type DatabaseObjectRow = typeof databaseObjects.$inferSelect;
export type DatabaseColumnRow = typeof databaseColumns.$inferSelect;
export type DatabaseRelationshipRow = typeof databaseRelationships.$inferSelect;
export type DatabaseIndexRow = typeof databaseIndexes.$inferSelect;
export type DatabaseConstraintRow = typeof databaseConstraints.$inferSelect;
export type DatabaseDependencyRow = typeof databaseDependencies.$inferSelect;
export type SqlScriptRow = typeof sqlScripts.$inferSelect;
export type SqlScriptVersionRow = typeof sqlScriptVersions.$inferSelect;
export type SqlAnalysisRow = typeof sqlAnalyses.$inferSelect;
export type AiConversationRow = typeof aiConversations.$inferSelect;
export type AiMessageRow = typeof aiMessages.$inferSelect;
export type QueryHistoryRow = typeof queryHistory.$inferSelect;
export type SchemaComparisonRow = typeof schemaComparisons.$inferSelect;
export type MigrationPlanRow = typeof migrationPlans.$inferSelect;
