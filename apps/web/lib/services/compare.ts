import "server-only";
import { diffSchemas, type DiffItem, type SchemaDiff, type SchemaSnapshot, type SnapObject } from "@querypilot/database-core";
import type { AuthedContext } from "@/lib/api";
import { getSnapshot } from "@/lib/data/queries";

export interface ComparisonPair {
  base: SchemaSnapshot;
  target: SchemaSnapshot;
  diff: SchemaDiff;
  baseLabel: string;
  targetLabel: string;
}

/** Loads two versions of the same project (RLS-verified, both fully imported) and diffs them. */
export async function loadComparison(ctx: AuthedContext, projectId: string, baseId: string, targetId: string): Promise<ComparisonPair | { error: string }> {
  if (baseId === targetId) return { error: "Choose two different versions." };
  const { data } = await ctx.supabase.from("database_versions").select("id,project_id,version_number,label,status").in("id", [baseId, targetId]);
  const base = data?.find((v) => v.id === baseId);
  const target = data?.find((v) => v.id === targetId);
  if (!base || !target || base.project_id !== projectId || target.project_id !== projectId) return { error: "Versions not found in this project." };
  const ok = (s: string) => s === "ready" || s === "ready_with_warnings";
  if (!ok(base.status) || !ok(target.status)) return { error: "Both versions must have finished importing." };
  const [b, t] = await Promise.all([getSnapshot(baseId, true), getSnapshot(targetId, true)]);
  const label = (v: { version_number: number; label: string | null }) => `v${v.version_number}${v.label ? ` ${v.label}` : ""}`;
  return { base: b, target: t, diff: diffSchemas(b, t), baseLabel: label(base), targetLabel: label(target) };
}

const compactObject = (o: SnapObject) => ({ id: o.id, schema: o.schema, name: o.name, type: o.type, columnCount: o.columns.length });
const isObject = (v: unknown): v is SnapObject => !!v && typeof v === "object" && "columns" in (v as object) && "type" in (v as object);

/** Removes bulky payloads (definitions, column lists) so diffs stay small when stored or sent to the browser. */
export function compactDiff(diff: SchemaDiff): SchemaDiff {
  const slim = (v: unknown) => (isObject(v) ? compactObject(v) : v);
  return { ...diff, items: diff.items.map((i: DiffItem) => ({ ...i, before: slim(i.before), after: slim(i.after) })) };
}
