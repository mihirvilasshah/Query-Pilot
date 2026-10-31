import type { DatabaseObjectType, DependencyConfidence, DependencyKind } from "@querypilot/shared-types";
import { analyzeSql, type StatementInfo } from "../sql/analyzer";
import { tokenize } from "../sql/tokenizer";
import { objectFullName, type SchemaSnapshot, type SnapObject } from "./model";

export interface GraphNode {
  id: string;
  type: DatabaseObjectType;
  schema: string;
  name: string;
  fullName: string;
  hasDynamicSql: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: DependencyKind | "foreign_key";
  confidence: DependencyConfidence;
  origin: string;
  operations: string[];
  label: string;
}

export interface UnresolvedReference {
  sourceId: string;
  targetName: string;
  kind: DependencyKind;
  confidence: DependencyConfidence;
  note: string | null;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
  /** Set when dynamic SQL or unresolved references mean the graph cannot be claimed to be complete. */
  completenessCaveat: string | null;
}

const GRAPH_TYPES: DatabaseObjectType[] = ["table", "view", "procedure", "function", "trigger"];

export function buildDependencyGraph(snap: SchemaSnapshot): DependencyGraph {
  const nodes: GraphNode[] = snap.objects
    .filter((o) => GRAPH_TYPES.includes(o.type))
    .map((o) => ({ id: o.id, type: o.type, schema: o.schema, name: o.name, fullName: objectFullName(o), hasDynamicSql: !!o.metadata.hasDynamicSql }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  const unresolved: UnresolvedReference[] = [];
  const seen = new Set<string>();

  for (const d of snap.dependencies ?? []) {
    if (!nodeIds.has(d.sourceObjectId)) continue;
    if (!d.targetObjectId || !nodeIds.has(d.targetObjectId)) {
      unresolved.push({
        sourceId: d.sourceObjectId,
        targetName: [d.targetSchema, d.targetName].filter(Boolean).join(".") || "(dynamic)",
        kind: d.kind,
        confidence: d.confidence,
        note: d.note,
      });
      continue;
    }
    const key = `${d.sourceObjectId}>${d.targetObjectId}>${d.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: d.id,
      source: d.sourceObjectId,
      target: d.targetObjectId,
      kind: d.kind,
      confidence: d.confidence,
      origin: d.origin,
      operations: d.operations,
      label: d.operations.length ? d.operations.join(", ") : d.kind.replace("_", " "),
    });
  }

  for (const r of snap.relationships) {
    if (!r.targetObjectId || !nodeIds.has(r.sourceObjectId) || !nodeIds.has(r.targetObjectId)) continue;
    edges.push({
      id: `fk:${r.id}`,
      source: r.sourceObjectId,
      target: r.targetObjectId,
      kind: "foreign_key",
      confidence: r.kind === "declared" ? "confirmed_static" : "inferred",
      origin: r.kind === "declared" ? "declared foreign key" : "name-based inference",
      operations: [],
      label: `${r.sourceColumns.join(", ")} → ${r.targetColumns.join(", ")}`,
    });
  }

  const dynamicCount = nodes.filter((n) => n.hasDynamicSql).length;
  const caveat =
    dynamicCount > 0 || unresolved.length > 0
      ? `This graph is not guaranteed to be complete: ${dynamicCount} object(s) contain dynamic SQL and ${unresolved.length} reference(s) could not be resolved to an imported object.`
      : null;
  return { nodes, edges, unresolved, completenessCaveat: caveat };
}

export type TraverseDirection = "outgoing" | "incoming" | "both";

/** Breadth-first neighbourhood of a node, limited by depth. */
export function neighborhood(graph: DependencyGraph, startId: string, direction: TraverseDirection, maxDepth: number): { nodeIds: Set<string>; edges: GraphEdge[] } {
  const nodeIds = new Set<string>([startId]);
  const edgeSet = new Map<string, GraphEdge>();
  let frontier = [startId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const e of graph.edges) {
      const out = direction !== "incoming" && frontier.includes(e.source);
      const inc = direction !== "outgoing" && frontier.includes(e.target);
      if (!out && !inc) continue;
      edgeSet.set(e.id, e);
      for (const id of [e.source, e.target]) {
        if (!nodeIds.has(id)) {
          nodeIds.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }
  return { nodeIds, edges: [...edgeSet.values()] };
}

export interface ColumnImpact {
  table: string;
  column: string;
  foreignKeys: { name: string | null; table: string; role: "references this column" | "uses this column" }[];
  indexes: string[];
  constraints: string[];
  /** Objects that reference the table and whose definition mentions the column name. Textual match - verify manually. */
  likelyReferences: { fullName: string; type: DatabaseObjectType; evidence: "column name found in definition" }[];
  /** Objects that reference the table but where the column name was not found (may use SELECT *). */
  tableOnlyReferences: { fullName: string; type: DatabaseObjectType }[];
  notes: string[];
}

export function analyzeColumnImpact(snap: SchemaSnapshot, tableId: string, columnName: string): ColumnImpact | null {
  const table = snap.objects.find((o) => o.id === tableId);
  if (!table) return null;
  const col = columnName.toLowerCase();
  const byId = new Map(snap.objects.map((o) => [o.id, o]));
  const foreignKeys: ColumnImpact["foreignKeys"] = [];
  for (const r of snap.relationships) {
    if (r.sourceObjectId === tableId && r.sourceColumns.some((c) => c.toLowerCase() === col)) {
      foreignKeys.push({ name: r.name, table: objectFullName(byId.get(r.targetObjectId ?? "") ?? { schema: r.targetSchema ?? "", name: r.targetName ?? "?" }), role: "uses this column" });
    }
    if (r.targetObjectId === tableId && r.targetColumns.some((c) => c.toLowerCase() === col)) {
      const src = byId.get(r.sourceObjectId);
      foreignKeys.push({ name: r.name, table: src ? objectFullName(src) : "?", role: "references this column" });
    }
  }
  const indexes = snap.indexes.filter((i) => i.objectId === tableId && (i.keyColumns.some((c) => c.name.toLowerCase() === col) || i.includedColumns.some((c) => c.toLowerCase() === col))).map((i) => i.name);
  const constraints = snap.constraints.filter((c) => c.objectId === tableId && c.columns.some((x) => x.toLowerCase() === col)).map((c) => c.name ?? c.type);

  const referencing = new Set<string>();
  for (const d of snap.dependencies ?? []) if (d.targetObjectId === tableId) referencing.add(d.sourceObjectId);
  const likely: ColumnImpact["likelyReferences"] = [];
  const tableOnly: ColumnImpact["tableOnlyReferences"] = [];
  for (const id of referencing) {
    const o = byId.get(id);
    if (!o) continue;
    const mentions = o.definition ? tokenize(o.definition).tokens.some((t) => (t.type === "word" || t.type === "ident") && (t.type === "ident" ? t.upper : t.value).toLowerCase() === col) : false;
    if (mentions) likely.push({ fullName: objectFullName(o), type: o.type, evidence: "column name found in definition" });
    else tableOnly.push({ fullName: objectFullName(o), type: o.type });
  }
  const notes = [
    "Column-level impact is derived from textual matching of definitions; dynamic SQL, application code and external consumers are not visible.",
  ];
  if ((snap.dependencies ?? []).length === 0) notes.push("No dependency metadata is available for this version, so referencing objects could not be listed.");
  return { table: objectFullName(table), column: columnName, foreignKeys, indexes, constraints, likelyReferences: likely, tableOnlyReferences: tableOnly, notes };
}

const esc = (s: string) => s.replace(/"/g, "'").replace(/[\r\n]+/g, " ").slice(0, 70);

/** Mermaid flowchart of a procedure's statement flow, derived from the analyzer (not from AI). */
export function procedureFlowchart(obj: SnapObject): string {
  if (!obj.definition) return "";
  const result = analyzeSql(obj.definition);
  const root = result.statements.find((s) => s.kind === "create" || s.kind === "alter");
  const body: StatementInfo[] = root ? root.children : result.statements;
  const lines = ["flowchart TD", `  start(["${esc(objectFullName(obj))}"])`];
  let prev = "start";
  let n = 0;
  const label = (s: StatementInfo): string => {
    const w = s.references.filter((r) => r.access === "write" || r.access === "ddl").map((r) => r.fullName);
    const r = s.references.filter((x) => x.access === "read").map((x) => x.fullName);
    const calls = s.references.filter((x) => x.access === "execute").map((x) => x.fullName);
    switch (s.kind) {
      case "select": return `SELECT${w.length ? ` INTO ${[...new Set(w)].join(", ")}` : ""}${r.length ? ` from ${[...new Set(r)].slice(0, 3).join(", ")}` : ""}`;
      case "insert": return `INSERT into ${[...new Set(w)].join(", ") || "?"}`;
      case "update": return `UPDATE ${[...new Set(w)].join(", ") || "?"}${s.hasWhere ? "" : " (no WHERE)"}`;
      case "delete": return `DELETE from ${[...new Set(w)].join(", ") || "?"}${s.hasWhere ? "" : " (no WHERE)"}`;
      case "merge": return `MERGE ${[...new Set(w)].join(", ")}`;
      case "exec": return s.isDynamicSql ? "EXEC dynamic SQL" : `EXEC ${calls.join(", ") || "?"}`;
      case "transaction": return s.text.split(/\s+/).slice(0, 3).join(" ").toUpperCase();
      case "truncate": return `TRUNCATE ${w.join(", ")}`;
      case "drop": case "create": case "alter": return `${s.kind.toUpperCase()} ${s.objectType ?? ""} ${w.join(", ")}`.trim();
      case "control": return s.text.split(/\s+/).slice(0, 6).join(" ");
      default: return s.text.split(/\s+/).slice(0, 5).join(" ");
    }
  };
  const interesting = body.filter((s) => !["declare", "set", "other"].includes(s.kind) && !(s.kind === "control" && /^(BEGIN|END)\b/i.test(s.text.trim()) && s.text.trim().split(/\s+/).length <= 2 && !/TRY|CATCH/i.test(s.text)));
  for (const s of interesting.slice(0, 40)) {
    const id = `n${++n}`;
    const shape = s.kind === "control" ? `{"${esc(label(s))}"}` : s.kind === "transaction" ? `[["${esc(label(s))}"]]` : `["${esc(label(s))}"]`;
    lines.push(`  ${id}${shape}`);
    lines.push(`  ${prev} --> ${id}`);
    prev = id;
  }
  if (interesting.length > 40) lines.push(`  n${n + 1}["... ${interesting.length - 40} more statements"]`, `  ${prev} --> n${n + 1}`);
  lines.push(`  ${interesting.length > 40 ? `n${n + 1}` : prev} --> finish(["end"])`);
  return lines.join("\n");
}
