import { AiError } from "../errors";
import { requestJson, type ClassifyResult, type HttpOptions } from "../http";
import { BaseAiProvider, type ProviderConfig } from "../base-provider";
import type { AiTextResult, GenerateTextRequest, KeyValidation, ModelInfo } from "../types";

const BASE = "https://api.groq.com/openai/v1";

interface GroqResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: number | string };
}

function classify(status: number, body: string): ClassifyResult {
  let msg = "";
  try {
    msg = (JSON.parse(body) as GroqResponse).error?.message ?? "";
  } catch {
    /* not JSON */
  }
  const short = msg.slice(0, 200);
  const lower = msg.toLowerCase();
  if (status === 401) return { code: "invalid_api_key", message: "Groq rejected the API key.", retryable: false };
  if (status === 403) return { code: "invalid_api_key", message: `Groq denied access${short ? `: ${short}` : "."}`, retryable: false };
  if (status === 404) return { code: "model_unavailable", message: `The Groq model is unavailable${short ? `: ${short}` : "."}`, retryable: false };
  if (status === 400 && (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("decommission")))) {
    return { code: "model_unavailable", message: `The Groq model is unavailable${short ? `: ${short}` : "."}`, retryable: false };
  }
  if (status === 429) return { code: "rate_limited", message: "Groq rate limit reached for this model.", retryable: true };
  if (status === 408 || status >= 500) return { code: "provider_error", message: `Groq is temporarily unavailable (${status}).`, retryable: true };
  return { code: "provider_error", message: `Groq returned an error: ${short || status}`, retryable: false };
}

export interface GroqConfig extends ProviderConfig {
  /** Send response_format=json_object. Defaults to prompt-based JSON for maximum model compatibility. */
  nativeJsonMode?: boolean;
}

export class GroqProvider extends BaseAiProvider {
  readonly id = "groq" as const;
  private readonly nativeJson: boolean;

  constructor(config: GroqConfig) {
    super(config);
    this.nativeJson = config.nativeJsonMode ?? false;
  }

  private get headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
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
      max_completion_tokens: request.maxOutputTokens ?? 4096,
      ...(request.json && this.nativeJson ? { response_format: { type: "json_object" } } : {}),
    };
    const json = (await requestJson(`${BASE}/chat/completions`, { method: "POST", headers: this.headers, body: JSON.stringify(body) }, this.http, classify)) as GroqResponse;
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
      provider: "groq",
      usage: { ...(json.usage?.prompt_tokens !== undefined ? { inputTokens: json.usage.prompt_tokens } : {}), ...(json.usage?.completion_tokens !== undefined ? { outputTokens: json.usage.completion_tokens } : {}) },
      latencyMs: Date.now() - started,
    };
  }

  async validateApiKey(): Promise<KeyValidation> {
    try {
      await requestJson(`${BASE}/models`, { method: "GET", headers: this.headers }, { ...this.http, maxRetries: 1 } satisfies HttpOptions, classify);
      return { valid: true, message: "API key accepted. Groq does not report remaining quota; free-tier limits depend on your Groq account." };
    } catch (e) {
      if (e instanceof AiError && e.code === "invalid_api_key") return { valid: false, message: e.message };
      throw e;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const json = (await requestJson(`${BASE}/models`, { method: "GET", headers: this.headers }, this.http, classify)) as {
      data?: { id: string; owned_by?: string; context_window?: number; active?: boolean }[];
    };
    return (json.data ?? [])
      .filter((m) => m.active !== false)
      .map((m) => ({
        id: m.id,
        label: m.id,
        free: null,
        ...(m.context_window ? { contextLength: m.context_window } : {}),
      }));
  }
}
