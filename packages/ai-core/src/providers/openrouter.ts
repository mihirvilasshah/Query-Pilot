import { AiError } from "../errors";
import { requestJson, type ClassifyResult, type HttpOptions } from "../http";
import { BaseAiProvider, type ProviderConfig } from "../base-provider";
import type { AiTextResult, GenerateTextRequest, KeyValidation, ModelInfo } from "../types";

const BASE = "https://openrouter.ai/api/v1";

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

function classify(status: number, body: string): ClassifyResult {
  let msg = "";
  try {
    msg = (JSON.parse(body) as OpenRouterResponse).error?.message ?? "";
  } catch {
    /* not JSON */
  }
  const short = msg.slice(0, 200);
  if (status === 401) return { code: "invalid_api_key", message: "OpenRouter rejected the API key.", retryable: false };
  if (status === 402) return { code: "paid_model_blocked", message: "OpenRouter says this model needs credits. QueryPilot only uses free models unless paid models are explicitly allowed.", retryable: false };
  if (status === 404) return { code: "model_unavailable", message: `The OpenRouter model is unavailable${short ? `: ${short}` : "."}`, retryable: false };
  if (status === 429) return { code: "rate_limited", message: "OpenRouter rate limit reached for this (free) model.", retryable: true };
  if (status === 408 || status >= 500) return { code: "provider_error", message: `OpenRouter is temporarily unavailable (${status}).`, retryable: true };
  return { code: "provider_error", message: `OpenRouter returned an error: ${short || status}`, retryable: false };
}

export interface OpenRouterConfig extends ProviderConfig {
  appName?: string;
  appUrl?: string;
  /** Send response_format=json_object. Many free models reject it, so the default is prompt-based JSON. */
  nativeJsonMode?: boolean;
  allowPaidModels?: boolean;
}

export class OpenRouterProvider extends BaseAiProvider {
  readonly id = "openrouter" as const;
  private readonly appName: string;
  private readonly appUrl: string | undefined;
  private readonly nativeJson: boolean;

  constructor(config: OpenRouterConfig) {
    super(config);
    if (!config.allowPaidModels && !config.model.endsWith(":free") && config.model !== "openrouter/free") {
      throw new AiError("paid_model_blocked", `Model "${config.model}" is not a free variant (":free"). Paid models must be allowed explicitly.`);
    }
    this.appName = config.appName ?? "QueryPilot";
    this.appUrl = config.appUrl;
    this.nativeJson = config.nativeJsonMode ?? false;
  }

  private get headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
      "x-title": this.appName,
      ...(this.appUrl ? { "http-referer": this.appUrl } : {}),
    };
  }

  protected async complete(request: GenerateTextRequest): Promise<AiTextResult> {
    const started = Date.now();
    const messages = [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      ...request.messages,
    ];
    const body = {
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens ?? 4096,
      ...(request.json && this.nativeJson ? { response_format: { type: "json_object" } } : {}),
    };
    const json = (await requestJson(`${BASE}/chat/completions`, { method: "POST", headers: this.headers, body: JSON.stringify(body) }, this.http, classify)) as OpenRouterResponse;
    if (json.error) {
      const code = Number(json.error.code);
      const c = classify(Number.isFinite(code) ? code : 500, JSON.stringify({ error: json.error }));
      throw new AiError(c.code, c.message, { retryable: false });
    }
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) throw new AiError("bad_response", "The model returned an empty response.");
    return {
      text,
      model: this.model,
      provider: "openrouter",
      usage: { ...(json.usage?.prompt_tokens !== undefined ? { inputTokens: json.usage.prompt_tokens } : {}), ...(json.usage?.completion_tokens !== undefined ? { outputTokens: json.usage.completion_tokens } : {}) },
      latencyMs: Date.now() - started,
    };
  }

  async validateApiKey(): Promise<KeyValidation> {
    try {
      const json = (await requestJson(`${BASE}/auth/key`, { method: "GET", headers: this.headers }, { ...this.http, maxRetries: 1 } satisfies HttpOptions, classify)) as {
        data?: { label?: string; usage?: number; limit?: number | null; is_free_tier?: boolean; limit_remaining?: number | null };
      };
      const d = json.data ?? {};
      return {
        valid: true,
        message: "API key accepted.",
        details: {
          label: d.label ?? null,
          usage: d.usage ?? null,
          limit: d.limit ?? null,
          limitRemaining: d.limit_remaining ?? null,
          isFreeTier: d.is_free_tier ?? null,
        },
      };
    } catch (e) {
      if (e instanceof AiError && e.code === "invalid_api_key") return { valid: false, message: e.message };
      throw e;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const json = (await requestJson(`${BASE}/models`, { method: "GET", headers: this.headers }, this.http, classify)) as {
      data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }[];
    };
    return (json.data ?? []).map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
      free: m.id.endsWith(":free") || (m.pricing?.prompt === "0" && m.pricing?.completion === "0"),
      ...(m.context_length ? { contextLength: m.context_length } : {}),
    }));
  }
}
