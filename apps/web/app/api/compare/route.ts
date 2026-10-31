import { NextResponse } from "next/server";
import { compareSchema } from "@querypilot/shared-validation";
import { apiError, authenticate, internalError, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import { recordHistory } from "@/lib/ai/context";
import { compactDiff, loadComparison } from "@/lib/services/compare";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, compareSchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "compare", 30, 60))) return tooManyRequests();
  try {
    const pair = await loadComparison(ctx, body.projectId, body.baseVersionId, body.targetVersionId);
    if ("error" in pair) return apiError(422, "invalid_versions", pair.error);
    const diff = compactDiff(pair.diff);
    const summary = { ...diff.summary, totals: diff.totals };
    const { data: row, error } = await ctx.supabase
      .from("schema_comparisons")
      .insert({ owner_id: ctx.user.id, project_id: body.projectId, base_version_id: body.baseVersionId, target_version_id: body.targetVersionId, summary, diff: { items: diff.items } })
      .select("id")
      .single();
    if (error || !row) return apiError(500, "save_failed", "Could not store the comparison.");
    await recordHistory(ctx, {
      operation: "schema_comparison", projectId: body.projectId, refId: row.id,
      title: `Compared ${pair.baseLabel} → ${pair.targetLabel}: +${diff.totals.added} ~${diff.totals.modified} -${diff.totals.removed}`,
      output: { totals: diff.totals },
    });
    return NextResponse.json({ comparisonId: row.id, diff, baseLabel: pair.baseLabel, targetLabel: pair.targetLabel });
  } catch (e) {
    return internalError(e, "compare");
  }
}
