import { NextResponse } from "next/server";
import { z } from "zod";
import { createAiProvider, isAiError, userMessageFor } from "@querypilot/ai-core";
import { aiErrorResponse, resolveAiConfig } from "@/lib/ai/config";
import { apiError, authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import { getAppUrl } from "@/lib/env";

const schema = z.object({
  provider: z.enum(["gemini", "openrouter", "groq"]),
  /** Optional: validate a key that has not been saved yet. It is used once and never stored by this route. */
  apiKey: z.string().trim().min(8).max(400).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "ai-validate", 10, 60))) return tooManyRequests();

  const { config, apiKey: stored } = await resolveAiConfig(ctx);
  const key = body.apiKey ?? (config.provider === body.provider ? stored : null);
  if (!key) return apiError(409, "ai_not_configured", "No API key available to validate for this provider.");
  try {
    const provider = createAiProvider({ provider: body.provider, apiKey: key, model: body.model ?? "validation", allowPaidModels: true, appName: "QueryPilot", appUrl: getAppUrl() });
    const result = await provider.validateApiKey();
    return NextResponse.json({ valid: result.valid, message: result.message, details: result.details ?? null });
  } catch (e) {
    if (isAiError(e)) return NextResponse.json({ valid: false, message: userMessageFor(e), details: null });
    return aiErrorResponse(e);
  }
}
