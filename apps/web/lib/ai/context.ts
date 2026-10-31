import "server-only";
import { retrieveContext, type RetrievedContext } from "@querypilot/database-core";
import type { QueryHistoryOperation } from "@querypilot/shared-types";
import type { AuthedContext } from "@/lib/api";
import { getSnapshot } from "@/lib/data/queries";

/**
 * Deterministic retrieval of the metadata relevant to `text`. Verifies (via RLS) that the version belongs to
 * the caller. Returns null when the version is not accessible.
 */
export async function buildSchemaContext(ctx: AuthedContext, versionId: string | null | undefined, text: string, focusObjectIds: string[] = [], maxChars = 9000): Promise<RetrievedContext | null> {
  if (!versionId) return null;
  const { data } = await ctx.supabase.from("database_versions").select("id,status").eq("id", versionId).maybeSingle();
  if (!data || (data.status !== "ready" && data.status !== "ready_with_warnings")) return null;
  const snapshot = await getSnapshot(versionId, true);
  return retrieveContext(snapshot, text, { maxChars, focusObjectIds });
}

export async function recordHistory(
  ctx: AuthedContext,
  entry: { operation: QueryHistoryOperation; title: string; projectId?: string | null; input?: Record<string, unknown>; output?: Record<string, unknown>; refId?: string | null },
): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("query_history")
    .insert({ owner_id: ctx.user.id, project_id: entry.projectId ?? null, operation: entry.operation, title: entry.title.slice(0, 200), input: entry.input ?? {}, output: entry.output ?? {}, ref_id: entry.refId ?? null })
    .select("id")
    .single();
  return data?.id ?? null;
}
