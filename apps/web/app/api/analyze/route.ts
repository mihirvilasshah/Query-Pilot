import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeSql, type StatementInfo } from "@querypilot/database-core";
import { sqlTextSchema } from "@querypilot/shared-validation";
import { getAiProvider, trackedAi, aiErrorResponse } from "@/lib/ai/config";
import { audit, authenticate, internalError, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import { isAiError } from "@querypilot/ai-core";

const bodySchema = sqlTextSchema.extend({ withAi: z.boolean().default(false), scriptId: z.uuid().optional().nullable() });

const slim = (s: StatementInfo): Omit<StatementInfo, "text"> & { text: string } => ({ ...s, text: s.text.length > 600 ? `${s.text.slice(0, 600)}…` : s.text, children: s.children.map(slim) });

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, bodySchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "analyze", 60, 60))) return tooManyRequests();

  try {
    const analysis = analyzeSql(body.sql, { dialect: body.dialect });
    const payload = {
      dialect: analysis.dialect,
      overallRisk: analysis.overallRisk,
      findings: analysis.findings,
      statements: analysis.statements.map(slim),
      tablesAffected: analysis.tablesAffected,
      routinesCalled: analysis.routinesCalled,
      statementCounts: analysis.statementCounts,
      batchCount: analysis.batchCount,
      parseWarnings: analysis.parseWarnings,
      limitations: analysis.limitations,
    };

    // Deterministic analysis first; AI only supplements it and its failure never blocks the result.
    let ai: { supplement?: unknown; model?: string; provider?: string; error?: { code: string; message: string } } | undefined;
    if (body.withAi) {
      const provider = await getAiProvider(ctx);
      if (isResponse(provider)) {
        const err = (await provider.json()) as { error: { code: string; message: string } };
        ai = { error: err.error };
      } else {
        try {
          const findingsText = analysis.findings.map((f) => `[${f.severity}] ${f.title} (line ${f.line})`).join("\n");
          const r = await trackedAi(ctx, provider, "analyze_sql", () => provider.provider.analyzeSQL({ sql: body.sql, dialect: body.dialect, staticFindings: findingsText }));
          ai = { supplement: r.data, model: provider.provider.model, provider: provider.provider.id };
        } catch (e) {
          const res = aiErrorResponse(e);
          ai = { error: ((await res.json()) as { error: { code: string; message: string } }).error };
          if (!isAiError(e)) console.error(e);
        }
      }
    }

    const { data: row } = await ctx.supabase
      .from("sql_analyses")
      .insert({ owner_id: ctx.user.id, project_id: body.projectId ?? null, script_id: body.scriptId ?? null, dialect: body.dialect, input_sql: body.sql, overall_risk: analysis.overallRisk, result: payload, ai_summary: ai?.supplement ? JSON.stringify(ai.supplement) : null })
      .select("id")
      .single();
    await ctx.supabase.from("query_history").insert({
      owner_id: ctx.user.id, project_id: body.projectId ?? null, operation: "sql_analyze",
      title: `Analyzed ${analysis.allStatements.length} statement(s) - ${analysis.overallRisk} risk`,
      input: { sql: body.sql.slice(0, 20000), dialect: body.dialect }, output: { overallRisk: analysis.overallRisk, findings: analysis.findings.length }, ref_id: row?.id ?? null,
    });
    await audit(ctx.supabase, ctx.user.id, "sql.analyzed", "sql_analysis", row?.id, { statements: analysis.allStatements.length });
    return NextResponse.json({ analysisId: row?.id ?? null, result: payload, ai });
  } catch (e) {
    return internalError(e, "analyze");
  }
}
