// Synthetic "Hospital Pricing" schema used by the mock Supabase backend (e2e tests and offline demos).
// Never contains real data.
let counter = 0;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const USER = { id: id(1), email: "demo@querypilot.test", password: "DemoPassw0rd1", displayName: "Demo User" };
export const PROJECT_ID = id(100);
export const EMPTY_PROJECT_ID = id(101);
export const V1 = id(200);
export const V2 = id(201);

const now = () => new Date().toISOString();

function col(objectId, name, ordinal, dataType, o = {}) {
  return { id: id(10_000 + ++counter), object_id: objectId, name, ordinal, data_type: dataType, max_length: o.len ?? null, numeric_precision: o.prec ?? null, numeric_scale: o.scale ?? null,
    is_nullable: o.nullable ?? true, default_value: o.def ?? null, is_identity: !!o.identity, is_primary_key: !!o.pk, is_computed: false, computed_expression: null };
}

export function buildVersion(versionId, variant) {
  const base = variant === 1 ? 300_000 : 400_000;
  const oid = (k) => id(base + k);
  const objects = [];
  const columns = [];
  const relationships = [];
  const indexes = [];
  const constraints = [];
  const dependencies = [];
  const add = (k, schema, name, type, definition, metadata = {}) => {
    const o = { id: oid(k), version_id: versionId, schema_name: schema, name, object_type: type, parent_object_id: null, definition, metadata, source_file: "HospitalPricing.sql", source_line: k * 10 };
    objects.push(o);
    return o;
  };
  const v2 = variant === 2;

  const ou = add(1, "dbo", "OperationalUnit", "table", "CREATE TABLE [dbo].[OperationalUnit] (\n  [OperationalUnitId] int NOT NULL PRIMARY KEY,\n  [Name] nvarchar(100) NOT NULL,\n  [Code] varchar(20) NULL\n);");
  columns.push(col(ou.id, "OperationalUnitId", 1, "int", { pk: true, nullable: false }), col(ou.id, "Name", 2, "nvarchar", { len: 100, nullable: false }), col(ou.id, "Code", 3, "varchar", { len: 20 }));

  const pl = add(2, "dbo", "PricingLevel", "table", `CREATE TABLE [dbo].[PricingLevel] (\n  [PricingLevelId] int IDENTITY NOT NULL PRIMARY KEY,\n  [Name] nvarchar(100) NOT NULL,\n  [OperationalUnitId] int NULL,\n  [Markup] decimal(9,${v2 ? 4 : 2}) NULL${v2 ? ",\n  [EffectiveFrom] date NULL" : ""}\n);`);
  columns.push(col(pl.id, "PricingLevelId", 1, "int", { pk: true, nullable: false, identity: true }), col(pl.id, "Name", 2, "nvarchar", { len: 100, nullable: false }), col(pl.id, "OperationalUnitId", 3, "int"), col(pl.id, "Markup", 4, "decimal", { prec: 9, scale: v2 ? 4 : 2, def: "((1.00))" }));
  if (v2) columns.push(col(pl.id, "EffectiveFrom", 5, "date"));

  const setting = add(3, "dbo", "PricingLevelOUSetting", "table", "CREATE TABLE [dbo].[PricingLevelOUSetting] (...);");
  columns.push(col(setting.id, "Id", 1, "int", { pk: true, nullable: false }), col(setting.id, "PricingLevelId", 2, "int", { nullable: false }), col(setting.id, "OperationalUnitId", 3, "int", { nullable: false }), col(setting.id, "IsActive", 4, "bit", { nullable: false }));

  const hosp = add(4, "dbo", "Hospital", "table", "CREATE TABLE [dbo].[Hospital] (...);");
  columns.push(col(hosp.id, "HospitalId", 1, "int", { pk: true, nullable: false }), col(hosp.id, "Name", 2, "nvarchar", { len: 200, nullable: false }), col(hosp.id, "OperationalUnitId", 3, "int"));

  const charge = add(5, "billing", "Charge", "table", "CREATE TABLE [billing].[Charge] (...);");
  columns.push(col(charge.id, "ChargeId", 1, "bigint", { pk: true, nullable: false, identity: true }), col(charge.id, "HospitalId", 2, "int", { nullable: false }), col(charge.id, "PricingLevelId", 3, "int", { nullable: false }), col(charge.id, "Amount", 4, "decimal", { prec: 18, scale: 2, nullable: false }));

  const log = add(6, "audit", "PricingLog", "table", "CREATE TABLE [audit].[PricingLog] (...);");
  columns.push(col(log.id, "LogId", 1, "int", { pk: true, nullable: false, identity: true }), col(log.id, "Message", 2, "nvarchar", { len: -1 }));

  if (v2) {
    const cur = add(7, "dbo", "Currency", "table", "CREATE TABLE [dbo].[Currency] (...);");
    columns.push(col(cur.id, "Code", 1, "char", { len: 3, pk: true, nullable: false }), col(cur.id, "Name", 2, "nvarchar", { len: 50, nullable: false }));
  }

  const view = add(10, "dbo", "vw_ActivePricing", "view", "CREATE VIEW dbo.vw_ActivePricing AS\nSELECT p.PricingLevelId, p.Name, s.OperationalUnitId\nFROM dbo.PricingLevel p\nJOIN dbo.PricingLevelOUSetting s ON s.PricingLevelId = p.PricingLevelId\nWHERE s.IsActive = 1;");
  columns.push(col(view.id, "PricingLevelId", 1, "int"), col(view.id, "Name", 2, "nvarchar", { len: 100 }));

  const fn = add(11, "dbo", "fn_GetMarkup", "function", "CREATE FUNCTION dbo.fn_GetMarkup (@PricingLevelId int)\nRETURNS decimal(9,2)\nAS\nBEGIN\n  RETURN (SELECT Markup FROM dbo.PricingLevel WHERE PricingLevelId = @PricingLevelId);\nEND", { parameters: [{ name: "@PricingLevelId", dataType: "int", direction: "in" }], returnType: "decimal(9,2)", functionType: "scalar" });

  const logChange = add(12, "dbo", "usp_LogChange", "procedure", "CREATE PROCEDURE dbo.usp_LogChange @msg nvarchar(max)\nAS\nBEGIN\n  INSERT INTO audit.PricingLog (Message) VALUES (@msg);\nEND", { parameters: [{ name: "@msg", dataType: "nvarchar(max)", direction: "in" }], operations: { select: 0, insert: 1, update: 0, delete: 0, merge: 0 } });

  const upd = add(13, "dbo", "usp_UpdatePricing", "procedure",
    `CREATE PROCEDURE dbo.usp_UpdatePricing @PricingLevelId int, @Markup decimal(9,${v2 ? 4 : 2})${v2 ? ", @EffectiveFrom date = NULL" : ""}\nAS\nBEGIN\n  SET NOCOUNT ON;\n  BEGIN TRY\n    BEGIN TRANSACTION;\n    UPDATE dbo.PricingLevel SET Markup = @Markup${v2 ? ", EffectiveFrom = @EffectiveFrom" : ""} WHERE PricingLevelId = @PricingLevelId;\n    EXEC dbo.usp_LogChange @msg = N'pricing updated';\n    COMMIT;\n  END TRY\n  BEGIN CATCH\n    ROLLBACK;\n    THROW;\n  END CATCH\nEND`,
    { parameters: [{ name: "@PricingLevelId", dataType: "int", direction: "in" }, { name: "@Markup", dataType: v2 ? "decimal(9,4)" : "decimal(9,2)", direction: "in" }, ...(v2 ? [{ name: "@EffectiveFrom", dataType: "date", direction: "in", hasDefault: true, defaultValue: "NULL" }] : [])], hasTransaction: true, operations: { select: 0, insert: 0, update: 1, delete: 0, merge: 0 } });

  const search = add(14, "dbo", "usp_SearchCharges", "procedure",
    "CREATE PROCEDURE dbo.usp_SearchCharges @term nvarchar(50)\nAS\nBEGIN\n  DECLARE @sql nvarchar(max) = N'SELECT * FROM billing.Charge WHERE HospitalId IN (SELECT HospitalId FROM dbo.Hospital WHERE Name LIKE ''%' + @term + N'%'')';\n  EXEC (@sql);\nEND",
    { parameters: [{ name: "@term", dataType: "nvarchar(50)", direction: "in" }], hasDynamicSql: true, dynamicSqlCount: 1, operations: { select: 0, insert: 0, update: 0, delete: 0, merge: 0 } });

  const trg = add(15, "dbo", "trg_PricingLevel_Audit", "trigger", "CREATE TRIGGER dbo.trg_PricingLevel_Audit ON dbo.PricingLevel AFTER UPDATE\nAS\nBEGIN\n  INSERT INTO audit.PricingLog (Message) SELECT 'PricingLevel changed' FROM inserted;\nEND",
    { triggerEvents: ["UPDATE"], triggerTiming: "AFTER", triggerParent: { schema: "dbo", name: "PricingLevel" } });

  const fk = (n, name, src, tgt, sc, tc, od) => relationships.push({ id: id(base + 5000 + n), name, kind: "declared", source_object_id: src.id, target_object_id: tgt.id, target_schema: tgt.schema_name, target_name: tgt.name, source_columns: sc, target_columns: tc, on_delete: od ?? null, on_update: null, origin: "scriptdom" });
  fk(1, "FK_PricingLevel_OperationalUnit", pl, ou, ["OperationalUnitId"], ["OperationalUnitId"]);
  fk(2, "FK_Setting_PricingLevel", setting, pl, ["PricingLevelId"], ["PricingLevelId"], "CASCADE");
  fk(3, "FK_Setting_OperationalUnit", setting, ou, ["OperationalUnitId"], ["OperationalUnitId"]);
  fk(4, "FK_Charge_Hospital", charge, hosp, ["HospitalId"], ["HospitalId"]);
  fk(5, "FK_Charge_PricingLevel", charge, pl, ["PricingLevelId"], ["PricingLevelId"]);
  // Hospital.OperationalUnitId has NO declared FK; a name-based inference is recorded separately and labelled as such.
  relationships.push({ id: id(base + 5100), name: null, kind: "inferred", source_object_id: hosp.id, target_object_id: ou.id, target_schema: "dbo", target_name: "OperationalUnit", source_columns: ["OperationalUnitId"], target_columns: ["OperationalUnitId"], on_delete: null, on_update: null, origin: "name-based inference" });

  indexes.push({ id: id(base + 6001), object_id: pl.id, name: "PK_PricingLevel", index_type: "CLUSTERED", is_unique: true, is_primary_key: true, is_unique_constraint: false, key_columns: [{ name: "PricingLevelId" }], included_columns: [], filter_definition: null });
  indexes.push({ id: id(base + 6002), object_id: pl.id, name: "IX_PricingLevel_OU", index_type: "NONCLUSTERED", is_unique: false, is_primary_key: false, is_unique_constraint: false, key_columns: [{ name: "OperationalUnitId" }], included_columns: ["Markup"], filter_definition: null });
  constraints.push({ id: id(base + 7001), object_id: pl.id, name: "PK_PricingLevel", constraint_type: "primary_key", columns: ["PricingLevelId"], expression: null });
  constraints.push({ id: id(base + 7002), object_id: pl.id, name: "DF_PricingLevel_Markup", constraint_type: "default", columns: ["Markup"], expression: "((1.00))" });
  constraints.push({ id: id(base + 7003), object_id: pl.id, name: "CK_PricingLevel_Markup", constraint_type: "check", columns: [], expression: "([Markup] >= (0))" });

  let d = 0;
  const dep = (src, tgt, kind, operations, confidence, origin, extra = {}) => dependencies.push({ id: id(base + 8000 + ++d), source_object_id: src.id, target_object_id: tgt?.id ?? null, target_schema: tgt?.schema_name ?? extra.schema ?? null, target_name: tgt?.name ?? extra.name ?? null, target_type: tgt?.object_type ?? null, kind, operations, confidence, origin, line: extra.line ?? 3, note: extra.note ?? null });
  dep(view, pl, "reads", ["select"], "confirmed_static", "dacfx");
  dep(view, setting, "reads", ["select"], "confirmed_static", "dacfx");
  dep(fn, pl, "reads", ["select"], "confirmed_static", "dacfx");
  dep(logChange, log, "writes", ["insert"], "confirmed_static", "dacfx");
  dep(upd, pl, "writes", ["update"], "confirmed_static", "dacfx");
  dep(upd, logChange, "executes", ["exec"], "confirmed_static", "dacfx");
  dep(search, null, "reads", ["select"], "unresolved_dynamic", "scriptdom", { schema: "billing", name: "Charge", note: "Referenced inside a dynamic SQL string; not statically resolved." });
  dep(search, null, "executes", [], "unresolved_dynamic", "scriptdom", { note: "EXEC(@sql) - dynamic SQL is not statically analysable." });
  dep(trg, pl, "trigger_on", [], "confirmed_static", "dacfx");
  dep(trg, log, "writes", ["insert"], "parsed_reference", "scriptdom");

  for (const list of [columns, relationships, indexes, constraints, dependencies]) for (const r of list) { r.version_id = versionId; r.owner_id = USER.id; }
  for (const o of objects) o.owner_id = USER.id;

  const counts = { schemas: 3, tables: objects.filter((o) => o.object_type === "table").length, views: 1, procedures: 3, functions: 1, triggers: 1, indexes: indexes.length, foreignKeys: 5, columns: columns.length, dependencies: dependencies.length };
  return { objects, columns, relationships, indexes, constraints, dependencies, counts };
}

export function seed() {
  counter = 0;
  const v1 = buildVersion(V1, 1);
  const v2 = buildVersion(V2, 2);
  const t = now();
  return {
    database_projects: [
      { id: PROJECT_ID, owner_id: USER.id, name: "Hospital Pricing Database", description: "Synthetic pricing schema used for demos and tests.", platform: "azure_sql_managed_instance", created_at: t, updated_at: t },
      { id: EMPTY_PROJECT_ID, owner_id: USER.id, name: "Empty Project", description: null, platform: "sqlserver", created_at: t, updated_at: new Date(Date.now() - 86_400_000).toISOString() },
    ],
    database_versions: [
      { id: V1, owner_id: USER.id, project_id: PROJECT_ID, version_number: 1, label: "Initial import", source_type: "sql", source_file_name: "HospitalPricing_v1.sql", storage_path: null, database_name: "HospitalPricing", status: "ready", summary: { sourceType: "sql", counts: v1.counts, unsupported: [], warnings: [], limitations: ["Dynamic SQL references are not resolved."] }, created_at: new Date(Date.now() - 7 * 86_400_000).toISOString(), updated_at: t },
      { id: V2, owner_id: USER.id, project_id: PROJECT_ID, version_number: 2, label: "Updated pricing tables", source_type: "dacpac", source_file_name: "HospitalPricing_v2.dacpac", storage_path: null, database_name: "HospitalPricing", status: "ready_with_warnings", summary: { sourceType: "dacpac", counts: v2.counts, unsupported: [{ objectType: "User", count: 2 }], warnings: [{ code: "UNSUPPORTED_OBJECT", message: "2 database user(s) were not imported." }], limitations: ["Dynamic SQL references are not resolved."] }, created_at: t, updated_at: t },
    ],
    database_import_jobs: [
      { id: id(500), owner_id: USER.id, project_id: PROJECT_ID, version_id: V1, status: "completed", stage: "Completed", progress: 100, file_name: "HospitalPricing_v1.sql", file_size: 4096, file_type: "sql", storage_path: "x", error_code: null, error_message: null, warnings: [], attempts: 1, max_attempts: 3, started_at: t, finished_at: t, created_at: t, updated_at: t },
      { id: id(501), owner_id: USER.id, project_id: PROJECT_ID, version_id: V2, status: "completed_with_warnings", stage: "Completed", progress: 100, file_name: "HospitalPricing_v2.dacpac", file_size: 9000, file_type: "dacpac", storage_path: "x", error_code: null, error_message: null, warnings: [{ code: "UNSUPPORTED_OBJECT", message: "2 database user(s) were not imported." }], attempts: 1, max_attempts: 3, started_at: t, finished_at: t, created_at: t, updated_at: t },
    ],
    database_objects: [...v1.objects, ...v2.objects],
    database_columns: [...v1.columns, ...v2.columns],
    database_relationships: [...v1.relationships, ...v2.relationships],
    database_indexes: [...v1.indexes, ...v2.indexes],
    database_constraints: [...v1.constraints, ...v2.constraints],
    database_dependencies: [...v1.dependencies, ...v2.dependencies],
    sql_scripts: [
      { id: id(600), owner_id: USER.id, project_id: PROJECT_ID, name: "Archive old charges", description: "Monthly archive", content: "DELETE FROM billing.Charge;", dialect: "tsql", tags: ["maintenance"], category: null, is_favorite: true, created_at: t, updated_at: t },
    ],
    sql_script_versions: [{ id: id(601), owner_id: USER.id, script_id: id(600), version_number: 1, name: "Archive old charges", content: "DELETE FROM billing.Charge;", change_note: "Created", created_at: t }],
    sql_analyses: [], query_history: [], ai_conversations: [], ai_messages: [], ai_requests: [], audit_logs: [], schema_comparisons: [], migration_plans: [],
    profiles: [{ id: USER.id, display_name: USER.displayName }],
    user_preferences: [{ id: id(700), user_id: USER.id, theme: "system", sidebar_collapsed: false, default_dialect: "tsql", ai_provider: null, ai_model: null, ai_external_consent: false, ai_external_consent_at: null }],
  };
}
