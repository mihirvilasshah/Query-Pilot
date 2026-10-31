import { NextResponse } from "next/server";
import { sqlTextSchema } from "@querypilot/shared-validation";
import { aiErrorResponse, getAiProvider, trackedAi } from "@/lib/ai/config";
import { buildSchemaContext, recordHistory } from "@/lib/ai/context";
import { authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, sqlTextSchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "ai", 30, 60))) return tooManyRequests();
  const ai = await getAiProvider(ctx);
  if (isResponse(ai)) return ai;
  try {
    const context = await buildSchemaContext(ctx, body.versionId, body.sql, [], 6000);
    const result = await trackedAi(ctx, ai, "optimize_sql", () => ai.provider.optimizeSQL({ sql: body.sql, dialect: body.dialect, ...(context ? { schemaContext: context.contextText } : {}) }));
    const id = await recordHistory(ctx, { operation: "sql_optimize", title: `Optimized SQL: ${body.sql.trim().slice(0, 60).replace(/\s+/g, " ")}`, projectId: body.projectId, input: { sql: body.sql.slice(0, 20000) }, output: { optimizedSql: result.data.optimizedSql } });
    return NextResponse.json({ optimization: result.data, model: result.model, provider: result.provider, historyId: id });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
