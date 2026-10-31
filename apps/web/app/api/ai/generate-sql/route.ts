import { NextResponse } from "next/server";
import { analyzeSql } from "@querypilot/database-core";
import { generateSqlSchema } from "@querypilot/shared-validation";
import { aiErrorResponse, getAiProvider, trackedAi } from "@/lib/ai/config";
import { buildSchemaContext, recordHistory } from "@/lib/ai/context";
import { authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";

export const maxDuration = 60;

/** Generates SQL as a *proposal*. It is statically analysed for risk and never executed. */
export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, generateSqlSchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "ai", 30, 60))) return tooManyRequests();
  const ai = await getAiProvider(ctx);
  if (isResponse(ai)) return ai;
  try {
    const context = await buildSchemaContext(ctx, body.versionId, `${body.request}\n${body.existingSql ?? ""}`, [], 9000);
    const result = await trackedAi(ctx, ai, "generate_sql", () =>
      ai.provider.generateSQL({ request: body.request, dialect: body.dialect, ...(body.existingSql ? { existingSql: body.existingSql } : {}), ...(context ? { schemaContext: context.contextText } : {}) }),
    );
    const generated = result.data;
    const analysis = generated.sql.trim() ? analyzeSql(generated.sql, { dialect: body.dialect }) : null;
    const id = await recordHistory(ctx, { operation: "sql_generate", title: `Generated SQL: ${body.request.slice(0, 70)}`, projectId: body.projectId, input: { request: body.request, dialect: body.dialect }, output: { sql: generated.sql, missingInformation: generated.missingInformation } });
    return NextResponse.json({
      generated,
      analysis: analysis ? { overallRisk: analysis.overallRisk, findings: analysis.findings, tablesAffected: analysis.tablesAffected } : null,
      model: result.model, provider: result.provider, historyId: id, usedMetadata: context?.objects.map((o) => o.fullName) ?? [],
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
