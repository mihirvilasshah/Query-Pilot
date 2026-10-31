import { tokenize } from "../sql/tokenizer";
import {
  formatDataType,
  objectFullName,
  type SchemaSnapshot,
  type SnapColumn,
  type SnapConstraint,
  type SnapIndex,
  type SnapObject,
  type SnapRelationship,
} from "./model";

export type DiffCategory =
  | "schema"
  | "table"
  | "column"
  | "primary_key"
  | "foreign_key"
  | "unique_constraint"
  | "check_constraint"
  | "default_constraint"
  | "index"
  | "view"
  | "procedure"
  | "function"
  | "trigger";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface PrimaryKeyPayload {
  name: string | null;
  columns: string[];
}
export interface SchemaPayload {
  name: string;
}

export interface DiffItem {
  id: string;
  category: DiffCategory;
  status: DiffStatus;
  /** Owning table (schema.name) for sub-objects such as columns, keys and indexes. */
  table?: string;
  name: string;
  changes: string[];
  before?: unknown;
  after?: unknown;
  /** True when applying the change can irreversibly lose data. */
  destructive: boolean;
  /** Extra non-data-loss warnings (breaking changes, statements that may fail on existing data). */
  riskNotes: string[];
}

export interface CategorySummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface SchemaDiff {
  items: DiffItem[];
  summary: Record<DiffCategory, CategorySummary>;
  totals: CategorySummary & { destructive: number };
}

export interface DiffOptions {
  includeUnchanged?: boolean;
}

const CATEGORIES: DiffCategory[] = [
  "schema", "table", "column", "primary_key", "foreign_key", "unique_constraint", "check_constraint",
  "default_constraint", "index", "view", "procedure", "function", "trigger",
];

const BUILTIN_SCHEMAS = new Set(["dbo", "sys", "guest", "information_schema"]);
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Canonical form of a SQL definition: comments/whitespace removed, keywords and identifiers case-folded. */
export function normalizeDefinition(sql: string | null | undefined): string {
  if (!sql) return "";
  const { tokens } = tokenize(sql);
  return tokens
    .filter((t) => t.type !== "go")
    .map((t) => (t.type === "string" ? t.value : t.type === "ident" ? t.upper.toLowerCase() : t.value.toLowerCase()))
    .join(" ")
    .replace(/\s*;\s*$/, "");
}

function normalizeDefault(v: string | null): string {
  let s = (v ?? "").replace(/\s+/g, "").toLowerCase();
  while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1);
  return s;
}

function same<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function summarize(items: DiffItem[], includeUnchanged: boolean): SchemaDiff {
  const summary = Object.fromEntries(CATEGORIES.map((c) => [c, { added: 0, removed: 0, modified: 0, unchanged: 0 }])) as Record<
    DiffCategory,
    CategorySummary
  >;
  let destructive = 0;
  for (const i of items) {
    summary[i.category][i.status]++;
    if (i.destructive) destructive++;
  }
  const totals = { added: 0, removed: 0, modified: 0, unchanged: 0, destructive };
  for (const c of CATEGORIES) {
    totals.added += summary[c].added;
    totals.removed += summary[c].removed;
    totals.modified += summary[c].modified;
    totals.unchanged += summary[c].unchanged;
  }
  return { items: includeUnchanged ? items : items.filter((i) => i.status !== "unchanged"), summary, totals };
}

function columnChanges(a: SnapColumn, b: SnapColumn): { changes: string[]; destructive: boolean; notes: string[] } {
  const changes: string[] = [];
  const notes: string[] = [];
  let destructive = false;
  const ta = formatDataType(a);
  const tb = formatDataType(b);
  if (ta !== tb) {
    changes.push(`Data type: ${ta} → ${tb}`);
    const lengthTypes = ["char", "varchar", "nchar", "nvarchar", "binary", "varbinary"];
    if (lc(a.dataType) === lc(b.dataType) && lengthTypes.includes(lc(a.dataType))) {
      const narrower = b.maxLength !== -1 && (a.maxLength === -1 || (a.maxLength ?? 0) > (b.maxLength ?? 0));
      if (narrower) {
        destructive = true;
        notes.push("Reducing the length can truncate existing data or make the ALTER fail.");
      }
    } else if (lc(a.dataType) !== lc(b.dataType)) {
      destructive = true;
      notes.push("Changing the data type can fail or lose precision for existing values; verify conversion.");
    } else if ((b.precision ?? 0) < (a.precision ?? 0) || (b.scale ?? 0) < (a.scale ?? 0)) {
      destructive = true;
      notes.push("Reducing precision/scale can round or overflow existing values.");
    }
  }
  if (a.nullable !== b.nullable) {
    changes.push(`Nullability: ${a.nullable === false ? "NOT NULL" : "NULL"} → ${b.nullable === false ? "NOT NULL" : "NULL"}`);
    if (b.nullable === false) notes.push("Existing NULL values must be backfilled before the column can become NOT NULL.");
  }
  if (normalizeDefault(a.defaultValue) !== normalizeDefault(b.defaultValue)) {
    changes.push(`Default: ${a.defaultValue ?? "(none)"} → ${b.defaultValue ?? "(none)"}`);
  }
  if (a.identity !== b.identity) {
    changes.push(`Identity: ${a.identity ? "yes" : "no"} → ${b.identity ? "yes" : "no"}`);
    notes.push("IDENTITY cannot be added to or removed from an existing column with ALTER COLUMN; the table must be rebuilt.");
  }
  if (a.computed !== b.computed || normalizeDefinition(a.computedExpression) !== normalizeDefinition(b.computedExpression)) {
    changes.push("Computed column definition changed");
    notes.push("Computed columns must be dropped and re-added to change their expression.");
  }
  return { changes, destructive, notes };
}

function fkTargetName(r: SnapRelationship, byId: Map<string, SnapObject>): string {
  const t = r.targetObjectId ? byId.get(r.targetObjectId) : undefined;
  if (t) return objectFullName(t);
  return r.targetSchema ? `${r.targetSchema}.${r.targetName ?? ""}` : (r.targetName ?? "");
}

function indexChanges(a: SnapIndex, b: SnapIndex): string[] {
  const out: string[] = [];
  if (lc(a.indexType) !== lc(b.indexType)) out.push(`Type: ${a.indexType ?? "?"} → ${b.indexType ?? "?"}`);
  if (a.isUnique !== b.isUnique) out.push(`Unique: ${a.isUnique} → ${b.isUnique}`);
  const ka = a.keyColumns.map((c) => `${lc(c.name)}${c.descending ? " desc" : ""}`);
  const kb = b.keyColumns.map((c) => `${lc(c.name)}${c.descending ? " desc" : ""}`);
  if (!same(ka, kb)) out.push(`Key columns: (${a.keyColumns.map((c) => c.name).join(", ")}) → (${b.keyColumns.map((c) => c.name).join(", ")})`);
  if (!same(a.includedColumns.map(lc).sort(), b.includedColumns.map(lc).sort())) out.push("Included columns changed");
  if (normalizeDefinition(a.filterDefinition) !== normalizeDefinition(b.filterDefinition)) out.push("Filter predicate changed");
  return out;
}

interface TableView {
  obj: SnapObject;
  key: string;
  pk: PrimaryKeyPayload | null;
  fks: Map<string, { rel: SnapRelationship; target: string }>;
  indexes: Map<string, SnapIndex>;
  uniques: Map<string, SnapConstraint>;
  checks: Map<string, SnapConstraint>;
  defaults: Map<string, SnapConstraint>;
}

function buildTableViews(snap: SchemaSnapshot): Map<string, TableView> {
  const byId = new Map(snap.objects.map((o) => [o.id, o]));
  const views = new Map<string, TableView>();
  for (const o of snap.objects) {
    if (o.type !== "table") continue;
    views.set(lc(objectFullName(o)), {
      obj: o,
      key: lc(objectFullName(o)),
      pk: null,
      fks: new Map(),
      indexes: new Map(),
      uniques: new Map(),
      checks: new Map(),
      defaults: new Map(),
    });
  }
  const byObjectId = new Map<string, TableView>();
  for (const v of views.values()) byObjectId.set(v.obj.id, v);

  for (const v of views.values()) {
    const pkCols = v.obj.columns.filter((c) => c.primaryKey).sort((a, b) => a.ordinal - b.ordinal).map((c) => c.name);
    const pkConstraint = snap.constraints.find((c) => c.objectId === v.obj.id && c.type === "primary_key");
    if (pkConstraint && pkConstraint.columns.length) v.pk = { name: pkConstraint.name, columns: pkConstraint.columns };
    else if (pkCols.length) v.pk = { name: null, columns: pkCols };
  }
  for (const r of snap.relationships) {
    if (r.kind !== "declared") continue;
    const v = byObjectId.get(r.sourceObjectId);
    if (!v) continue;
    const target = fkTargetName(r, byId);
    const sig = `${r.sourceColumns.map(lc).join(",")}->${lc(target)}(${r.targetColumns.map(lc).join(",")})`;
    v.fks.set(r.name ? lc(r.name) : sig, { rel: r, target });
  }
  for (const i of snap.indexes) {
    if (i.isPrimaryKey || i.isUniqueConstraint) continue;
    byObjectId.get(i.objectId)?.indexes.set(lc(i.name), i);
  }
  for (const c of snap.constraints) {
    const v = byObjectId.get(c.objectId);
    if (!v) continue;
    if (c.type === "unique") v.uniques.set(c.name ? lc(c.name) : lc(c.columns.join(",")), c);
    if (c.type === "check") v.checks.set(c.name ? lc(c.name) : normalizeDefinition(c.expression), c);
    if (c.type === "default") v.defaults.set(c.name ? lc(c.name) : lc(c.columns.join(",")), c);
  }
  return views;
}

function schemaSet(snap: SchemaSnapshot): Set<string> {
  const s = new Set<string>();
  for (const o of snap.objects) {
    const n = o.type === "schema" ? o.name : o.schema;
    if (n && !BUILTIN_SCHEMAS.has(lc(n))) s.add(n);
  }
  return s;
}

/** Pure, deterministic comparison of two schema snapshots. */
export function diffSchemas(base: SchemaSnapshot, target: SchemaSnapshot, options: DiffOptions = {}): SchemaDiff {
  const items: DiffItem[] = [];
  let seq = 0;

  const push = (item: Omit<DiffItem, "id" | "riskNotes" | "destructive"> & { destructive?: boolean; riskNotes?: string[] }) => {
    items.push({ destructive: false, riskNotes: [], ...item, id: `d${++seq}` });
  };

  // schemas
  const bs = schemaSet(base);
  const ts = schemaSet(target);
  const lcBase = new Map([...bs].map((s) => [lc(s), s]));
  const lcTarget = new Map([...ts].map((s) => [lc(s), s]));
  for (const [k, name] of lcTarget) {
    if (!lcBase.has(k)) push({ category: "schema", status: "added", name, changes: ["Schema added"], after: { name } satisfies SchemaPayload });
    else push({ category: "schema", status: "unchanged", name, changes: [] });
  }
  for (const [k, name] of lcBase) {
    if (!lcTarget.has(k)) push({ category: "schema", status: "removed", name, changes: ["Schema removed"], before: { name } satisfies SchemaPayload, riskNotes: ["Objects in the schema must be removed first."] });
  }

  // programmable objects
  const programmable = ["view", "procedure", "function", "trigger"] as const;
  for (const type of programmable) {
    const bm = new Map(base.objects.filter((o) => o.type === type).map((o) => [lc(objectFullName(o)), o]));
    const tm = new Map(target.objects.filter((o) => o.type === type).map((o) => [lc(objectFullName(o)), o]));
    for (const [k, o] of tm) {
      const prev = bm.get(k);
      if (!prev) {
        push({ category: type, status: "added", name: objectFullName(o), changes: [`${type} added`], after: o });
      } else if (normalizeDefinition(prev.definition) !== normalizeDefinition(o.definition)) {
        const notes: string[] = [];
        const pa = (prev.metadata.parameters ?? []).map((p) => `${p.name}:${p.dataType}`).join(",");
        const pb = (o.metadata.parameters ?? []).map((p) => `${p.name}:${p.dataType}`).join(",");
        const changes = ["Definition changed"];
        if (pa !== pb) {
          changes.push("Parameter list changed");
          notes.push("Callers may break because the signature changed.");
        }
        if (type === "view" || type === "function") {
          if ((prev.metadata.returnType ?? "") !== (o.metadata.returnType ?? "")) changes.push("Return type changed");
        }
        push({ category: type, status: "modified", name: objectFullName(o), changes, before: prev, after: o, riskNotes: notes });
      } else {
        push({ category: type, status: "unchanged", name: objectFullName(o), changes: [] });
      }
    }
    for (const [k, o] of bm) {
      if (!tm.has(k)) {
        push({ category: type, status: "removed", name: objectFullName(o), changes: [`${type} removed`], before: o, riskNotes: ["Dependent objects and applications may break."] });
      }
    }
  }

  // tables and their sub-objects
  const bt = buildTableViews(base);
  const tt = buildTableViews(target);

  const subItems = (tableName: string, bv: TableView | undefined, tv: TableView | undefined) => {
    // columns
    const bc = new Map((bv?.obj.columns ?? []).map((c) => [lc(c.name), c]));
    const tc = new Map((tv?.obj.columns ?? []).map((c) => [lc(c.name), c]));
    for (const [k, c] of tc) {
      const prev = bc.get(k);
      if (!prev) {
        const notes: string[] = [];
        if (bv && c.nullable === false && !c.defaultValue && !c.identity && !c.computed) {
          notes.push("Adding a NOT NULL column without a default fails when the table already contains rows.");
        }
        push({ category: "column", status: "added", table: tableName, name: c.name, changes: [`Added ${formatDataType(c)} ${c.nullable === false ? "NOT NULL" : "NULL"}`], after: c, riskNotes: notes });
      } else {
        const r = columnChanges(prev, c);
        if (r.changes.length) {
          push({ category: "column", status: "modified", table: tableName, name: c.name, changes: r.changes, before: prev, after: c, destructive: r.destructive, riskNotes: r.notes });
        } else push({ category: "column", status: "unchanged", table: tableName, name: c.name, changes: [] });
      }
    }
    if (bv && tv) {
      for (const [k, c] of bc) {
        if (!tc.has(k)) {
          push({ category: "column", status: "removed", table: tableName, name: c.name, changes: [`Removed ${formatDataType(c)}`], before: c, destructive: true, riskNotes: ["All data stored in the column is lost."] });
        }
      }
    }

    // primary key
    const bp = bv?.pk ?? null;
    const tp = tv?.pk ?? null;
    if (tp && !bp) push({ category: "primary_key", status: "added", table: tableName, name: tp.name ?? "PK", changes: [`Primary key (${tp.columns.join(", ")})`], after: tp });
    else if (!tp && bp && tv) push({ category: "primary_key", status: "removed", table: tableName, name: bp.name ?? "PK", changes: [`Primary key removed (${bp.columns.join(", ")})`], before: bp, riskNotes: ["Foreign keys referencing this key must be dropped first."] });
    else if (tp && bp) {
      if (!same(bp.columns.map(lc), tp.columns.map(lc))) {
        push({ category: "primary_key", status: "modified", table: tableName, name: tp.name ?? "PK", changes: [`Columns: (${bp.columns.join(", ")}) → (${tp.columns.join(", ")})`], before: bp, after: tp, riskNotes: ["Rebuilding the primary key rewrites the table; referencing foreign keys must be dropped and recreated."] });
      } else push({ category: "primary_key", status: "unchanged", table: tableName, name: tp.name ?? "PK", changes: [] });
    }

    // foreign keys
    const bf = bv?.fks ?? new Map();
    const tf = tv?.fks ?? new Map();
    for (const [k, f] of tf) {
      const prev = bf.get(k);
      const label = f.rel.name ?? `FK (${f.rel.sourceColumns.join(", ")})`;
      if (!prev) {
        push({ category: "foreign_key", status: "added", table: tableName, name: label, changes: [`(${f.rel.sourceColumns.join(", ")}) → ${f.target}(${f.rel.targetColumns.join(", ")})`], after: { ...f.rel, targetFull: f.target }, riskNotes: bv ? ["Existing rows that violate the constraint will make the ALTER fail."] : [] });
      } else {
        const ch: string[] = [];
        if (!same(prev.rel.sourceColumns.map(lc), f.rel.sourceColumns.map(lc))) ch.push("Referencing columns changed");
        if (lc(prev.target) !== lc(f.target) || !same(prev.rel.targetColumns.map(lc), f.rel.targetColumns.map(lc))) ch.push(`Target: ${prev.target} → ${f.target}`);
        if (lc(prev.rel.onDelete ?? "no action") !== lc(f.rel.onDelete ?? "no action")) ch.push(`ON DELETE: ${prev.rel.onDelete ?? "NO ACTION"} → ${f.rel.onDelete ?? "NO ACTION"}`);
        if (lc(prev.rel.onUpdate ?? "no action") !== lc(f.rel.onUpdate ?? "no action")) ch.push(`ON UPDATE: ${prev.rel.onUpdate ?? "NO ACTION"} → ${f.rel.onUpdate ?? "NO ACTION"}`);
        if (ch.length) push({ category: "foreign_key", status: "modified", table: tableName, name: label, changes: ch, before: { ...prev.rel, targetFull: prev.target }, after: { ...f.rel, targetFull: f.target } });
        else push({ category: "foreign_key", status: "unchanged", table: tableName, name: label, changes: [] });
      }
    }
    if (tv) {
      for (const [k, f] of bf) {
        if (!tf.has(k)) push({ category: "foreign_key", status: "removed", table: tableName, name: f.rel.name ?? `FK (${f.rel.sourceColumns.join(", ")})`, changes: ["Foreign key removed"], before: { ...f.rel, targetFull: f.target } });
      }
    }

    // indexes
    const bi = bv?.indexes ?? new Map<string, SnapIndex>();
    const ti = tv?.indexes ?? new Map<string, SnapIndex>();
    for (const [k, i] of ti) {
      const prev = bi.get(k);
      if (!prev) push({ category: "index", status: "added", table: tableName, name: i.name, changes: [`${i.isUnique ? "Unique " : ""}index (${i.keyColumns.map((c) => c.name).join(", ")})`], after: i });
      else {
        const ch = indexChanges(prev, i);
        if (ch.length) push({ category: "index", status: "modified", table: tableName, name: i.name, changes: ch, before: prev, after: i });
        else push({ category: "index", status: "unchanged", table: tableName, name: i.name, changes: [] });
      }
    }
    if (tv) for (const [k, i] of bi) if (!ti.has(k)) push({ category: "index", status: "removed", table: tableName, name: i.name, changes: ["Index removed"], before: i, riskNotes: ["Queries relying on this index may slow down."] });

    // unique / check / default constraints
    const constraintDiff = (
      category: "unique_constraint" | "check_constraint" | "default_constraint",
      bm: Map<string, SnapConstraint>,
      tm: Map<string, SnapConstraint>,
    ) => {
      const describe = (c: SnapConstraint) => (category === "check_constraint" ? c.expression ?? "" : category === "default_constraint" ? `${c.columns.join(", ")} = ${c.expression ?? ""}` : `(${c.columns.join(", ")})`);
      for (const [k, c] of tm) {
        const prev = bm.get(k);
        const name = c.name ?? describe(c);
        if (!prev) {
          push({ category, status: "added", table: tableName, name, changes: [describe(c)], after: c, riskNotes: bv && category !== "default_constraint" ? ["Existing rows that violate the constraint will make the ALTER fail."] : [] });
        } else if (category === "unique_constraint" ? !same(prev.columns.map(lc), c.columns.map(lc)) : normalizeDefinition(prev.expression) !== normalizeDefinition(c.expression) || !same(prev.columns.map(lc), c.columns.map(lc))) {
          push({ category, status: "modified", table: tableName, name, changes: [`${describe(prev)} → ${describe(c)}`], before: prev, after: c });
        } else push({ category, status: "unchanged", table: tableName, name, changes: [] });
      }
      if (tv) for (const [k, c] of bm) if (!tm.has(k)) push({ category, status: "removed", table: tableName, name: c.name ?? describe(c), changes: [`Removed ${describe(c)}`], before: c });
    };
    constraintDiff("unique_constraint", bv?.uniques ?? new Map(), tv?.uniques ?? new Map());
    constraintDiff("check_constraint", bv?.checks ?? new Map(), tv?.checks ?? new Map());
    constraintDiff("default_constraint", bv?.defaults ?? new Map(), tv?.defaults ?? new Map());
  };

  for (const [k, tv] of tt) {
    const bv = bt.get(k);
    const name = objectFullName(tv.obj);
    if (!bv) {
      push({ category: "table", status: "added", name, changes: [`Table added with ${tv.obj.columns.length} column(s)`], after: tv.obj });
      subItems(name, undefined, tv);
    } else {
      subItems(name, bv, tv);
      // table is modified only through its sub-objects; the table row itself is reported as unchanged
      push({ category: "table", status: "unchanged", name, changes: [] });
    }
  }
  for (const [k, bv] of bt) {
    if (!tt.has(k)) {
      push({ category: "table", status: "removed", name: objectFullName(bv.obj), changes: [`Table removed (${bv.obj.columns.length} column(s))`], before: bv.obj, destructive: true, riskNotes: ["The table and all of its data are lost."] });
    }
  }

  // derive "modified" tables: a surviving table with any non-unchanged sub-item
  const touched = new Set(items.filter((i) => i.table && i.status !== "unchanged").map((i) => lc(i.table)));
  for (const i of items) {
    if (i.category === "table" && i.status === "unchanged" && touched.has(lc(i.name))) {
      i.status = "modified";
      i.changes = items.filter((x) => lc(x.table) === lc(i.name) && x.status !== "unchanged").map((x) => `${x.category.replace("_", " ")} ${x.name}: ${x.status}`);
      i.destructive = items.some((x) => lc(x.table) === lc(i.name) && x.destructive);
    }
  }

  const order: Record<string, number> = Object.fromEntries(CATEGORIES.map((c, i) => [c, i]));
  items.sort((a, b) => (order[a.category] ?? 0) - (order[b.category] ?? 0) || (a.table ?? a.name).localeCompare(b.table ?? b.name) || a.name.localeCompare(b.name));
  return summarize(items, options.includeUnchanged ?? false);
}
