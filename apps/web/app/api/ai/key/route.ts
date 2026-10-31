import { NextResponse } from "next/server";
import { z } from "zod";
import { apiKeySchema } from "@querypilot/shared-validation";
import { createAiProvider, isAiError, userMessageFor } from "@querypilot/ai-core";
import { apiError, audit, authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import { encryptSecret, isEncryptionConfigured, keyHint } from "@/lib/crypto";
import { getAppUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/** Stores an AES-256-GCM encrypted, per-user provider key. The key is validated first and never echoed back. */
export async function PUT(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  if (!isEncryptionConfigured()) return apiError(501, "encryption_not_configured", "Saving keys requires CREDENTIAL_ENCRYPTION_KEY on the server. Use server environment variables instead (see docs/AI_PROVIDER_SETUP.md).");
  const admin = createAdminClient();
  if (!admin) return apiError(501, "service_role_missing", "Saving keys requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  const body = await parseBody(request, apiKeySchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "ai-key", 10, 600))) return tooManyRequests();

  try {
    const provider = createAiProvider({ provider: body.provider, apiKey: body.apiKey, model: "validation", allowPaidModels: true, appUrl: getAppUrl() });
    const v = await provider.validateApiKey();
    if (!v.valid) return apiError(422, "invalid_api_key", v.message);
  } catch (e) {
    if (isAiError(e) && e.code !== "invalid_api_key") return apiError(502, `ai_${e.code}`, userMessageFor(e));
    if (isAiError(e)) return apiError(422, "invalid_api_key", userMessageFor(e));
    return apiError(500, "validation_failed", "Could not validate the key.");
  }

  const enc = encryptSecret(body.apiKey);
  const { error } = await admin.from("user_ai_credentials").upsert(
    { owner_id: ctx.user.id, provider: body.provider, ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag, key_version: enc.keyVersion, key_hint: keyHint(body.apiKey), validated_at: new Date().toISOString() },
    { onConflict: "owner_id,provider" },
  );
  if (error) return apiError(500, "save_failed", "Could not store the key.");
  await audit(ctx.supabase, ctx.user.id, "ai.key_saved", "user_ai_credential", undefined, { provider: body.provider });
  return NextResponse.json({ ok: true, keyHint: keyHint(body.apiKey) });
}

export async function DELETE(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const provider = z.enum(["gemini", "openrouter"]).safeParse(new URL(request.url).searchParams.get("provider"));
  if (!provider.success) return apiError(422, "validation_failed", "Unknown provider.");
  const admin = createAdminClient();
  if (!admin) return apiError(501, "service_role_missing", "Server is not configured to manage stored keys.");
  const { error } = await admin.from("user_ai_credentials").delete().eq("owner_id", ctx.user.id).eq("provider", provider.data);
  if (error) return apiError(500, "delete_failed", "Could not remove the key.");
  await audit(ctx.supabase, ctx.user.id, "ai.key_removed", "user_ai_credential", undefined, { provider: provider.data });
  return NextResponse.json({ ok: true });
}
