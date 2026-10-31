import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/data/queries";

export interface ExplorerStats {
  columns: Map<string, number>;
  fkOut: Map<string, number>;
  fkIn: Map<string, number>;
  depsOut: Map<string, { reads: number; writes: number; executes: number; calls: number; total: number }>;
  depsIn: Map<string, number>;
  indexes: Map<string, number>;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const inc = (m: Map<string, number>, k: string | null) => k && m.set(k, (m.get(k) ?? 0) + 1);

/** Lightweight per-object counters used by the explorer lists (column/key/dependency counts). */
export const getExplorerStats = cache(async (versionId: string): Promise<ExplorerStats> => {
  const supabase = await createClient();
  const [cols, rels, deps, idx] = await Promise.all([
    fetchAll<{ object_id: string }>((f, t) => supabase.from("database_columns").select("object_id").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<{ object_id: string }>),
    fetchAll<{ source_object_id: string; target_object_id: string | null; kind: string }>((f, t) => supabase.from("database_relationships").select("source_object_id,target_object_id,kind").eq("version_id", versionId).eq("kind", "declared").order("id").range(f, t) as unknown as Page<{ source_object_id: string; target_object_id: string | null; kind: string }>),
    fetchAll<{ source_object_id: string; target_object_id: string | null; kind: string }>((f, t) => supabase.from("database_dependencies").select("source_object_id,target_object_id,kind").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<{ source_object_id: string; target_object_id: string | null; kind: string }>),
    fetchAll<{ object_id: string }>((f, t) => supabase.from("database_indexes").select("object_id").eq("version_id", versionId).order("id").range(f, t) as unknown as Page<{ object_id: string }>),
  ]);
  const stats: ExplorerStats = { columns: new Map(), fkOut: new Map(), fkIn: new Map(), depsOut: new Map(), depsIn: new Map(), indexes: new Map() };
  for (const c of cols) inc(stats.columns, c.object_id);
  for (const r of rels) { inc(stats.fkOut, r.source_object_id); inc(stats.fkIn, r.target_object_id); }
  for (const i of idx) inc(stats.indexes, i.object_id);
  for (const d of deps) {
    const e = stats.depsOut.get(d.source_object_id) ?? { reads: 0, writes: 0, executes: 0, calls: 0, total: 0 };
    if (d.kind === "reads") e.reads++;
    else if (d.kind === "writes") e.writes++;
    else if (d.kind === "executes") e.executes++;
    else if (d.kind === "calls_function") e.calls++;
    e.total++;
    stats.depsOut.set(d.source_object_id, e);
    inc(stats.depsIn, d.target_object_id);
  }
  return stats;
});
