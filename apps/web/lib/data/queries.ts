import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { SchemaSnapshot, SnapColumn, SnapObject } from "@querypilot/database-core";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type {
  ColumnRow, ConstraintRow, DependencyRow, ImportJobRow, IndexRow, ObjectRow, ProjectRow, RelationshipRow, VersionRow,
} from "@/lib/data/types";

export const PROJECT_COOKIE = "qp_project";
const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** PostgREST caps responses at 1000 rows; large schemas need explicit pagination. */
export async function fetchAll<T>(build: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export const getProjects = cache(async (): Promise<ProjectRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("database_projects").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectRow[];
});

/** The project the user is working in: cookie value when valid, otherwise the most recently updated one. */
export const getCurrentProject = cache(async (): Promise<ProjectRow | null> => {
  const projects = await getProjects();
  if (projects.length === 0) return null;
  const id = (await cookies()).get(PROJECT_COOKIE)?.value;
  return projects.find((p) => p.id === id) ?? projects[0] ?? null;
});

export const getVersions = cache(async (projectId: string): Promise<VersionRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("database_versions").select("*").eq("project_id", projectId).order("version_number", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as VersionRow[];
});

export const isReady = (v: VersionRow) => v.status === "ready" || v.status === "ready_with_warnings";

export interface ProjectContext {
  project: ProjectRow | null;
  versions: VersionRow[];
  /** Selected version (query param `v`, otherwise the latest successfully imported one). */
  version: VersionRow | null;
}

export async function getProjectContext(versionParam?: string | null): Promise<ProjectContext> {
  const project = await getCurrentProject();
  if (!project) return { project: null, versions: [], version: null };
  const versions = await getVersions(project.id);
  const ready = versions.filter(isReady);
  const version = (versionParam ? ready.find((v) => v.id === versionParam) : undefined) ?? ready[0] ?? null;
  return { project, versions, version };
}

export const getImportJobs = cache(async (projectId: string, limit = 20): Promise<ImportJobRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("database_import_jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportJobRow[];
});

const OBJECT_LIST_COLUMNS = "id,version_id,schema_name,name,object_type,parent_object_id,metadata,source_file,source_line";

export const getObjectList = cache(async (versionId: string, type?: ObjectRow["object_type"]): Promise<ObjectRow[]> => {
  const supabase = await createClient();
  const rows = await fetchAll<ObjectRow>((from, to) => {
    let q = supabase.from("database_objects").select(OBJECT_LIST_COLUMNS).eq("version_id", versionId);
    if (type) q = q.eq("object_type", type);
    return q.order("schema_name").order("name").range(from, to) as unknown as Page<ObjectRow>;
  });
  return rows.map((r) => ({ ...r, definition: null }));
});

export async function getObject(objectId: string): Promise<ObjectRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("database_objects").select("*").eq("id", objectId).maybeSingle();
  return (data as ObjectRow | null) ?? null;
}

export async function getObjectColumns(objectId: string): Promise<ColumnRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("database_columns").select("*").eq("object_id", objectId).order("ordinal");
  if (error) throw new Error(error.message);
  return (data ?? []) as ColumnRow[];
}

export interface ObjectDetail {
  object: ObjectRow;
  columns: ColumnRow[];
  indexes: IndexRow[];
  constraints: ConstraintRow[];
  outgoingRelationships: RelationshipRow[];
  incomingRelationships: RelationshipRow[];
  outgoing: DependencyRow[];
  incoming: DependencyRow[];
  nameById: Record<string, { schema: string; name: string; type: string }>;
}

export async function getObjectDetail(objectId: string): Promise<ObjectDetail | null> {
  const supabase = await createClient();
  const object = await getObject(objectId);
  if (!object) return null;
  const [columns, indexes, constraints, outRel, inRel, outDep, inDep] = await Promise.all([
    getObjectColumns(objectId),
    supabase.from("database_indexes").select("*").eq("object_id", objectId).then((r) => (r.data ?? []) as IndexRow[]),
    supabase.from("database_constraints").select("*").eq("object_id", objectId).then((r) => (r.data ?? []) as ConstraintRow[]),
    supabase.from("database_relationships").select("*").eq("source_object_id", objectId).then((r) => (r.data ?? []) as RelationshipRow[]),
    supabase.from("database_relationships").select("*").eq("target_object_id", objectId).then((r) => (r.data ?? []) as RelationshipRow[]),
    supabase.from("database_dependencies").select("*").eq("source_object_id", objectId).then((r) => (r.data ?? []) as DependencyRow[]),
    supabase.from("database_dependencies").select("*").eq("target_object_id", objectId).then((r) => (r.data ?? []) as DependencyRow[]),
  ]);
  const ids = new Set<string>();
  for (const r of [...outRel, ...inRel]) {
    ids.add(r.source_object_id);
    if (r.target_object_id) ids.add(r.target_object_id);
  }
  for (const d of [...outDep, ...inDep]) {
    ids.add(d.source_object_id);
    if (d.target_object_id) ids.add(d.target_object_id);
  }
  const nameById: ObjectDetail["nameById"] = {};
  if (ids.size) {
    const { data } = await supabase.from("database_objects").select("id,schema_name,name,object_type").in("id", [...ids]);
    for (const o of (data ?? []) as Pick<ObjectRow, "id" | "schema_name" | "name" | "object_type">[]) nameById[o.id] = { schema: o.schema_name, name: o.name, type: o.object_type };
  }
  return { object, columns, indexes, constraints, outgoingRelationships: outRel, incomingRelationships: inRel, outgoing: outDep, incoming: inDep, nameById };
}

export interface VersionData {
  objects: ObjectRow[];
  columns: ColumnRow[];
  relationships: RelationshipRow[];
  indexes: IndexRow[];
  constraints: ConstraintRow[];
  dependencies: DependencyRow[];
}

export async function loadVersionData(supabase: ServerSupabase, versionId: string, withDefinitions: boolean): Promise<VersionData> {
  const objCols = withDefinitions ? "*" : OBJECT_LIST_COLUMNS;
  const [objects, columns, relationships, indexes, constraints, dependencies] = await Promise.all([
    fetchAll<ObjectRow>((f, t) => supabase.from("database_objects").select(objCols).eq("version_id", versionId).order("id").range(f, t) as unknown as Page<ObjectRow>),
    fetchAll<ColumnRow & { version_id: string }>((f, t) => supabase.from("database_columns").select("*").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<ColumnRow & { version_id: string }>),
    fetchAll<RelationshipRow>((f, t) => supabase.from("database_relationships").select("*").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<RelationshipRow>),
    fetchAll<IndexRow>((f, t) => supabase.from("database_indexes").select("*").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<IndexRow>),
    fetchAll<ConstraintRow>((f, t) => supabase.from("database_constraints").select("*").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<ConstraintRow>),
    fetchAll<DependencyRow>((f, t) => supabase.from("database_dependencies").select("*").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<DependencyRow>),
  ]);
  return { objects, columns, relationships, indexes, constraints, dependencies };
}

export function toSnapshot(d: VersionData): SchemaSnapshot {
  const colsByObject = new Map<string, SnapColumn[]>();
  for (const c of d.columns) {
    const list = colsByObject.get(c.object_id) ?? [];
    list.push({
      name: c.name, ordinal: c.ordinal, dataType: c.data_type, maxLength: c.max_length, precision: c.numeric_precision,
      scale: c.numeric_scale, nullable: c.is_nullable, defaultValue: c.default_value, identity: c.is_identity,
      primaryKey: c.is_primary_key, computed: c.is_computed, computedExpression: c.computed_expression,
    });
    colsByObject.set(c.object_id, list);
  }
  const objects: SnapObject[] = d.objects.map((o) => ({
    id: o.id, schema: o.schema_name, name: o.name, type: o.object_type, definition: o.definition,
    metadata: o.metadata as SnapObject["metadata"], columns: (colsByObject.get(o.id) ?? []).sort((a, b) => a.ordinal - b.ordinal),
  }));
  return {
    objects,
    relationships: d.relationships.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, sourceObjectId: r.source_object_id, targetObjectId: r.target_object_id,
      targetSchema: r.target_schema, targetName: r.target_name, sourceColumns: r.source_columns, targetColumns: r.target_columns,
      onDelete: r.on_delete, onUpdate: r.on_update,
    })),
    indexes: d.indexes.map((i) => ({
      id: i.id, objectId: i.object_id, name: i.name, indexType: i.index_type, isUnique: i.is_unique, isPrimaryKey: i.is_primary_key,
      isUniqueConstraint: i.is_unique_constraint, keyColumns: i.key_columns, includedColumns: i.included_columns, filterDefinition: i.filter_definition,
    })),
    constraints: d.constraints.map((c) => ({ id: c.id, objectId: c.object_id, name: c.name, type: c.constraint_type, columns: c.columns, expression: c.expression })),
    dependencies: d.dependencies.map((x) => ({
      id: x.id, sourceObjectId: x.source_object_id, targetObjectId: x.target_object_id, targetSchema: x.target_schema, targetName: x.target_name,
      targetType: x.target_type, kind: x.kind, operations: x.operations, confidence: x.confidence, origin: x.origin, line: x.line, note: x.note,
    })),
  };
}

/** Full snapshot (with definitions) of one version for diffing, retrieval and graph building. */
export async function getSnapshot(versionId: string, withDefinitions = true): Promise<SchemaSnapshot> {
  const supabase = await createClient();
  return toSnapshot(await loadVersionData(supabase, versionId, withDefinitions));
}
