import { NextResponse } from "next/server";
import { generateMigration } from "@querypilot/database-core";
import { compareSchema } from "@querypilot/shared-validation";
import { apiError, audit, authenticate, internalError, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import { recordHistory } from "@/lib/ai/context";
import { loadComparison } from "@/lib/services/compare";

export const maxDuration = 60;

/** Generates (never executes) migration SQL, rollback suggestions, validation queries and a checklist. */
export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, compareSchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "migration", 20, 60))) return tooManyRequests();
  try {
    const pair = await loadComparison(ctx, body.projectId, body.baseVersionId, body.targetVersionId);
    if ("error" in pair) return apiError(422, "invalid_versions", pair.error);
    const plan = generateMigration(pair.base, pair.target, { destructive: body.includeDestructive ? "include" : "comment-out" }, pair.diff);
    plan.title = `Migration ${pair.baseLabel} → ${pair.targetLabel}`;

    const { data: row, error } = await ctx.supabase
      .from("migration_plans")
      .insert({
        owner_id: ctx.user.id, project_id: body.projectId, source_version_id: body.baseVersionId, target_version_id: body.targetVersionId, title: plan.title,
        plan: { ...plan, migrationSql: undefined, rollbackSql: undefined }, migration_sql: plan.migrationSql, rollback_sql: plan.rollbackSql,
      })
      .select("id")
      .single();
    if (error || !row) return apiError(500, "save_failed", "Could not store the migration plan.");
    await recordHistory(ctx, { operation: "migration_plan", projectId: body.projectId, refId: row.id, title: plan.title, output: { steps: plan.steps.length, destructive: plan.destructiveCount } });
    await audit(ctx.supabase, ctx.user.id, "migration.generated", "migration_plan", row.id, { destructiveIncluded: body.includeDestructive });
    return NextResponse.json({ planId: row.id, plan });
  } catch (e) {
    return internalError(e, "migrations");
  }
}
