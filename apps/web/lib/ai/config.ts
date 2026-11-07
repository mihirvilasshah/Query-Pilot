import "server-only";
import type { NextResponse } from "next/server";
import { isAiError, createAiProvider, userMessageFor, type AiProvider } from "@querypilot/ai-core";
import type { AiProviderId } from "@querypilot/shared-types";
import { apiError, type AuthedContext } from "@/lib/api";
import { decryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { getAppUrl, getServerAiEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PreferencesRow } from "@/lib/data/types";

export type AiStatus = "ready" | "needs_consent" | "not_configured";

export interface ResolvedAiConfig {
  status: AiStatus;
  provider: AiProviderId;
  model: string;
  keySource: "user" | "environment" | null;
  consent: boolean;
  allowPaidModels: boolean;
  /** Last 4 chars of a user-stored key, for display only. */
  keyHint: string | null;
}

export async function getPreferences(ctx: AuthedContext): Promise<PreferencesRow> {
  const { data } = await ctx.supabase.from("user_preferences").select("*").eq("user_id", ctx.user.id).maybeSingle();
  if (data) return data as PreferencesRow;
  const { data: created } = await ctx.supabase.from("user_preferences").insert({ user_id: ctx.user.id }).select("*").single();
  return created as PreferencesRow;
}

async function loadUserKey(userId: string, provider: AiProviderId): Promise<{ key: string | null; hint: string | null }> {
  if (!isEncryptionConfigured()) return { key: null, hint: null };
  const admin = createAdminClient();
  if (!admin) return { key: null, hint: null };
  const { data, error } = await admin
    .from("user_ai_credentials")
    .select("ciphertext,iv,auth_tag,key_hint")
    .eq("owner_id", userId)
    .eq("provider", provider)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[ai] load user key failed", error.message);
    return { key: null, hint: null };
  }
  const row = data?.[0];
  if (!row) return { key: null, hint: null };
  try {
    return { key: decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }), hint: row.key_hint };
  } catch (e) {
    console.error("[ai] decrypt user key failed", e instanceof Error ? e.message : e);
    return { key: null, hint: row.key_hint };
  }
}

export async function resolveAiConfig(ctx: AuthedContext): Promise<{ config: ResolvedAiConfig; apiKey: string | null }> {
  const env = getServerAiEnv();
  const prefs = await getPreferences(ctx);
  const provider = prefs.ai_provider ?? env.defaultProvider;
  const model = prefs.ai_model ?? env[provider].model;
  const user = await loadUserKey(ctx.user.id, provider);
  const apiKey = user.key ?? env[provider].apiKey;
  const keySource = user.key ? "user" : user.hint ? "user" : env[provider].apiKey ? "environment" : null;
  const consent = prefs.ai_external_consent;
  const status: AiStatus = !apiKey ? "not_configured" : !consent ? "needs_consent" : "ready";
  return { config: { status, provider, model, keySource, consent, allowPaidModels: env.allowPaidModels, keyHint: user.hint }, apiKey };
}

/**
 * Returns a provider only when a key exists AND the user has explicitly consented to sending
 * schema metadata / SQL to an external provider. Otherwise returns the error response to send.
 */
export async function getAiProvider(ctx: AuthedContext): Promise<{ provider: AiProvider; config: ResolvedAiConfig } | NextResponse> {
  const { config, apiKey } = await resolveAiConfig(ctx);
  if (config.status === "not_configured") return apiError(409, "ai_not_configured", "No AI provider is configured. Add an API key in Settings → AI. All non-AI features keep working.");
  if (config.status === "needs_consent") return apiError(403, "ai_consent_required", "Confirm in Settings → AI that SQL definitions and metadata may be sent to the external AI provider.");
  try {
    const provider = createAiProvider({
      provider: config.provider,
      apiKey,
      model: config.model,
      allowPaidModels: config.allowPaidModels,
      appName: "QueryPilot",
      appUrl: getAppUrl(),
    });
    return { provider, config };
  } catch (e) {
    return aiErrorResponse(e);
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  not_configured: 409,
  invalid_api_key: 401,
  rate_limited: 429,
  timeout: 504,
  model_unavailable: 404,
  paid_model_blocked: 402,
  content_blocked: 422,
  bad_response: 502,
  provider_error: 502,
  network_error: 502,
};

export function aiErrorResponse(e: unknown): NextResponse {
  if (isAiError(e)) return apiError(STATUS_BY_CODE[e.code] ?? 502, `ai_${e.code}`, userMessageFor(e));
  console.error("[ai] unexpected", e instanceof Error ? e.message : e);
  return apiError(500, "ai_failed", userMessageFor(e));
}

/** Runs an AI call and records it in ai_requests (no prompts, no keys, no responses are stored). */
export async function trackedAi<T extends { usage?: { inputTokens?: number; outputTokens?: number }; latencyMs?: number }>(
  ctx: AuthedContext,
  ai: { provider: AiProvider },
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await ctx.supabase.from("ai_requests").insert({
      owner_id: ctx.user.id, provider: ai.provider.id, model: ai.provider.model, operation, status: "success",
      latency_ms: result.latencyMs ?? Date.now() - started, input_tokens: result.usage?.inputTokens ?? null, output_tokens: result.usage?.outputTokens ?? null,
    });
    return result;
  } catch (e) {
    const code = isAiError(e) ? e.code : "unknown";
    await ctx.supabase.from("ai_requests").insert({
      owner_id: ctx.user.id, provider: ai.provider.id, model: ai.provider.model, operation,
      status: code === "rate_limited" ? "rate_limited" : code === "timeout" ? "timeout" : "error", latency_ms: Date.now() - started, error_code: code,
    });
    throw e;
  }
}
