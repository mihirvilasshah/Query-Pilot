import { NextResponse } from "next/server";
import { explainObjectSchema } from "@querypilot/shared-validation";
import { aiErrorResponse, getAiProvider, trackedAi } from "@/lib/ai/config";
import { buildSchemaContext } from "@/lib/ai/context";
import { apiError, authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import { getObject } from "@/lib/data/queries";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, explainObjectSchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "ai", 30, 60))) return tooManyRequests();
  const obj = await getObject(body.objectId);
  if (!obj) return apiError(404, "not_found", "Object not found.");
  const ai = await getAiProvider(ctx);
  if (isResponse(ai)) return ai;
  try {
    const fullName = obj.schema_name ? `${obj.schema_name}.${obj.name}` : obj.name;
    // The focused object's definition is part of the retrieved context, so it is not sent a second time.
    const context = await buildSchemaContext(ctx, obj.version_id, fullName, [obj.id], 14000);
    if (!context) return apiError(409, "version_not_ready", "This schema version is not available.");
    const result = await trackedAi(ctx, ai, "explain_object", () => ai.provider.explainDatabaseObject({ objectType: obj.object_type, fullName, definition: null, contextText: context.contextText }));
    return NextResponse.json({ explanation: result.data, model: result.model, provider: result.provider, contextObjects: context.objects.map((o) => o.fullName) });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
