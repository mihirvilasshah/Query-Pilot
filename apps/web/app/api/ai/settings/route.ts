import { NextResponse } from "next/server";
import { aiSettingsSchema } from "@querypilot/shared-validation";
import { createAiProvider } from "@querypilot/ai-core";
import { getPreferences, resolveAiConfig } from "@/lib/ai/config";
import { apiError, audit, authenticate, isResponse, parseBody } from "@/lib/api";
import { getServerAiEnv } from "@/lib/env";

export async function GET() {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { config } = await resolveAiConfig(ctx);
  return NextResponse.json({ config });
}

export async function PUT(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, aiSettingsSchema);
  if (isResponse(body)) return body;

  // Reject paid OpenRouter models up front (same rule the provider enforces at request time).
  if (!getServerAiEnv().allowPaidModels) {
    try {
      createAiProvider({ provider: body.provider, apiKey: "x".repeat(8), model: body.model, allowPaidModels: false });
    } catch (e) {
      return apiError(422, "paid_model_blocked", e instanceof Error ? e.message : "That model is not allowed.");
    }
  }
  const prefs = await getPreferences(ctx);
  const consentChanged = prefs.ai_external_consent !== body.externalConsent;
  const { error } = await ctx.supabase.from("user_preferences").update({
    ai_provider: body.provider, ai_model: body.model, ai_external_consent: body.externalConsent,
    ai_external_consent_at: body.externalConsent ? (consentChanged ? new Date().toISOString() : prefs.ai_external_consent_at) : null,
  }).eq("user_id", ctx.user.id);
  if (error) return apiError(500, "save_failed", "Could not save AI settings.");
  if (consentChanged) await audit(ctx.supabase, ctx.user.id, body.externalConsent ? "ai.consent_granted" : "ai.consent_revoked");
  const { config } = await resolveAiConfig(ctx);
  return NextResponse.json({ config });
}
