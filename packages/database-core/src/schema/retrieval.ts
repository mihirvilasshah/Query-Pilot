import type { DatabaseObjectType } from "@querypilot/shared-types";
import { buildDependencyGraph } from "./graph";
import { formatDataType, objectFullName, type SchemaSnapshot, type SnapObject } from "./model";

export interface ObjectRef {
  id: string;
  type: DatabaseObjectType;
  fullName: string;
}

export interface RetrievedContext {
  /** Objects selected as relevant, ranked. */
  objects: ObjectRef[];
  /** Compact text block to place in the AI prompt. Deterministic and bounded. */
  contextText: string;
  /** Human-readable explanation of why objects were selected (shown in the UI). */
  matchReasons: { fullName: string; reason: string }[];
  truncated: boolean;
}

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "were", "be", "this", "that", "these", "those", "what", "which", "who",
  "how", "why", "does", "do", "did", "it", "its", "with", "by", "from", "all", "any", "me", "my", "i", "you", "can", "could", "would", "should", "explain",
  "find", "show", "list", "table", "tables", "procedure", "procedures", "stored", "view", "views", "function", "functions", "trigger", "triggers", "column",
  "columns", "database", "schema", "reference", "references", "referenced", "modify", "modifies", "generate", "documentation", "step", "between", "about", "if",
  "removed", "impact", "impacted", "affected", "relationships", "relationship", "work", "together", "complete", "architecture", "objects", "object", "sql",
]);

const splitWords = (s: string): string[] =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\W]+/g, " ").toLowerCase().split(/\s+/).filter(Boolean);

function describeObject(o: SnapObject, snap: SchemaSnapshot, maxDef: number): string {
  const lines: string[] = [`### ${o.type.toUpperCase()} ${objectFullName(o)}`];
  if (o.type === "table") {
    lines.push("Columns: " + o.columns.map((c) => `${c.name} ${formatDataType(c)}${c.nullable === false ? " NOT NULL" : ""}${c.primaryKey ? " PK" : ""}${c.identity ? " IDENTITY" : ""}`).join("; "));
    const fks = snap.relationships.filter((r) => r.sourceObjectId === o.id);
    for (const r of fks) lines.push(`FK ${r.name ?? ""} (${r.sourceColumns.join(", ")}) -> ${r.targetSchema ? `${r.targetSchema}.` : ""}${r.targetName ?? "?"}(${r.targetColumns.join(", ")}) [${r.kind}]`);
    const inbound = snap.relationships.filter((r) => r.targetObjectId === o.id).map((r) => snap.objects.find((x) => x.id === r.sourceObjectId)).filter(Boolean) as SnapObject[];
    if (inbound.length) lines.push("Referenced by FKs from: " + inbound.map(objectFullName).join(", "));
  } else {
    const p = o.metadata.parameters;
    if (p?.length) lines.push("Parameters: " + p.map((x) => `${x.name} ${x.dataType}${x.direction !== "in" ? ` ${x.direction.toUpperCase()}` : ""}`).join(", "));
    if (o.metadata.returnType) lines.push(`Returns: ${o.metadata.returnType}`);
    if (o.metadata.hasDynamicSql) lines.push("Contains dynamic SQL (references inside it are NOT statically resolved).");
    if (o.definition) lines.push("Definition:\n" + (o.definition.length > maxDef ? `${o.definition.slice(0, maxDef)}\n-- [definition truncated]` : o.definition));
  }
  const byId = new Map(snap.objects.map((x) => [x.id, x]));
  const outgoing = (snap.dependencies ?? []).filter((d) => d.sourceObjectId === o.id);
  if (outgoing.length) {
    lines.push(
      "Depends on: " +
        outgoing.slice(0, 25).map((d) => `${d.targetObjectId ? objectFullName(byId.get(d.targetObjectId) ?? { schema: "", name: "?" }) : `${d.targetSchema ?? ""}.${d.targetName ?? "(dynamic)"}`} [${d.kind}${d.operations.length ? `: ${d.operations.join("/")}` : ""}; ${d.confidence}]`).join("; "),
    );
  }
  const incoming = (snap.dependencies ?? []).filter((d) => d.targetObjectId === o.id);
  if (incoming.length) {
    lines.push("Used by: " + incoming.slice(0, 25).map((d) => `${objectFullName(byId.get(d.sourceObjectId) ?? { schema: "", name: "?" })} [${d.kind}${d.operations.length ? `: ${d.operations.join("/")}` : ""}]`).join("; "));
  }
  return lines.join("\n");
}

export interface RetrievalOptions {
  maxObjects?: number;
  maxChars?: number;
  /** Object ids the user is currently looking at; always included first. */
  focusObjectIds?: string[];
  /** Max definition characters rendered for focused objects (default 24000). */
  focusDefinitionChars?: number;
}

/**
 * Deterministic retrieval over imported metadata: scores objects by name/column matches against the
 * question, expands through confirmed dependencies, and renders a bounded context block. The AI only
 * ever sees what this returns, never the whole schema.
 */
export function retrieveContext(snap: SchemaSnapshot, question: string, options: RetrievalOptions = {}): RetrievedContext {
  const maxObjects = options.maxObjects ?? 12;
  const maxChars = options.maxChars ?? 14000;
  const q = question.toLowerCase();
  const qWords = new Set(splitWords(question).filter((w) => w.length > 2 && !STOP.has(w)));
  const candidates = snap.objects.filter((o) => o.type !== "schema");
  const scores = new Map<string, { score: number; reasons: string[] }>();
  const bump = (id: string, n: number, why: string) => {
    const e = scores.get(id) ?? { score: 0, reasons: [] };
    e.score += n;
    if (!e.reasons.includes(why)) e.reasons.push(why);
    scores.set(id, e);
  };

  for (const id of options.focusObjectIds ?? []) bump(id, 100, "currently selected");

  for (const o of candidates) {
    const full = objectFullName(o).toLowerCase();
    if (q.includes(o.name.toLowerCase()) && o.name.length > 2) bump(o.id, 50, `name "${o.name}" appears in the question`);
    else if (q.includes(full)) bump(o.id, 50, `name "${full}" appears in the question`);
    const nameWords = splitWords(o.name);
    const overlap = nameWords.filter((w) => qWords.has(w));
    if (overlap.length) bump(o.id, overlap.length * 8, `name matches: ${overlap.join(", ")}`);
    if (o.type === "table") {
      for (const c of o.columns) {
        if (q.includes(c.name.toLowerCase()) && c.name.length > 3) bump(o.id, 12, `column "${c.name}" appears in the question`);
      }
    }
  }

  // expand through dependencies of strong matches
  const strong = [...scores.entries()].filter(([, v]) => v.score >= 40).map(([id]) => id);
  const graph = buildDependencyGraph(snap);
  for (const id of strong) {
    for (const e of graph.edges) {
      if (e.source === id) bump(e.target, 6, "referenced by a matched object");
      if (e.target === id) bump(e.source, 6, "references a matched object");
    }
  }

  let ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, maxObjects);
  if (ranked.length === 0) {
    // broad question (e.g. "explain the architecture"): fall back to the most connected objects
    const degree = new Map<string, number>();
    for (const e of graph.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    ranked = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxObjects).map(([id, d]) => [id, { score: d, reasons: ["highly connected object"] }] as [string, { score: number; reasons: string[] }]);
  }

  const byId = new Map(snap.objects.map((o) => [o.id, o]));
  const objects: ObjectRef[] = [];
  const reasons: RetrievedContext["matchReasons"] = [];
  const blocks: string[] = [];
  let used = 0;
  let truncated = false;
  const counts = new Map<string, number>();
  for (const o of snap.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const header = `Database inventory: ${[...counts.entries()].map(([t, n]) => `${n} ${t}(s)`).join(", ")}.`;
  used += header.length;

  for (const [id, info] of ranked) {
    const o = byId.get(id);
    if (!o) continue;
    const isFocus = (options.focusObjectIds ?? []).includes(id);
    const block = describeObject(o, snap, isFocus ? (options.focusDefinitionChars ?? 24000) : Math.max(1500, Math.floor(maxChars / Math.max(3, ranked.length))));
    if (used + block.length > maxChars) {
      truncated = true;
      break;
    }
    used += block.length;
    blocks.push(block);
    objects.push({ id: o.id, type: o.type, fullName: objectFullName(o) });
    reasons.push({ fullName: objectFullName(o), reason: info.reasons.join("; ") });
  }

  return { objects, contextText: [header, ...blocks].join("\n\n"), matchReasons: reasons, truncated };
}
