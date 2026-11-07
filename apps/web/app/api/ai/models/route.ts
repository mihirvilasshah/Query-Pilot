import { NextResponse } from "next/server";
import { z } from "zod";
import { SUGGESTED_MODELS, createAiProvider, isAiError, type ModelInfo } from "@querypilot/ai-core";
import { resolveAiConfig } from "@/lib/ai/config";
import { apiError, authenticate, isResponse, withinRateLimit, tooManyRequests } from "@/lib/api";
import { getAppUrl } from "@/lib/env";

const providerSchema = z.enum(["gemini", "openrouter", "groq"]);

/** Lists models for a provider using the caller's key; falls back to suggestions when no key is available. */
export async function GET(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const p = providerSchema.safeParse(new URL(request.url).searchParams.get("provider"));
  if (!p.success) return apiError(422, "validation_failed", "Unknown provider.");
  if (!(await withinRateLimit(ctx.supabase, "ai-models", 20, 60))) return tooManyRequests();

  const suggested: ModelInfo[] = SUGGESTED_MODELS[p.data].map((m) => ({ id: m.id, label: m.id, free: p.data === "openrouter" ? true : null }));
  const { config, apiKey } = await resolveAiConfig(ctx);
  const key = config.provider === p.data ? apiKey : null;
  // OpenRouter's model list is public; Gemini's and Groq's require a key.
  if (!key && (p.data === "gemini" || p.data === "groq")) return NextResponse.json({ models: suggested, source: "suggested" });
  try {
    const provider = createAiProvider({ provider: p.data, apiKey: key ?? "public", model: "x:free", allowPaidModels: true, appName: "QueryPilot", appUrl: getAppUrl() });
    let models = await provider.listModels();
    if (p.data === "openrouter") models = models.filter((m) => m.free || config.allowPaidModels).sort((a, b) => a.id.localeCompare(b.id));
    if (p.data === "groq") models = models.sort((a, b) => a.id.localeCompare(b.id));
    return NextResponse.json({ models: models.slice(0, 300), source: "provider" });
  } catch (e) {
    if (isAiError(e)) return NextResponse.json({ models: suggested, source: "suggested", warning: "Could not load the live model list; showing suggestions." });
    return NextResponse.json({ models: suggested, source: "suggested" });
  }
}
