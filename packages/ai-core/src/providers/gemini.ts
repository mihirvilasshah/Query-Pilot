import { AiError } from "../errors";
import { requestJson, type ClassifyResult } from "../http";
import { BaseAiProvider } from "../base-provider";
import type { AiTextResult, GenerateTextRequest, KeyValidation, ModelInfo } from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

const redact = (s: string): string => s.replace(/key=[^&\s"']+/gi, "key=***").slice(0, 240);

function classify(status: number, body: string): ClassifyResult {
  let msg = "";
  try {
    msg = (JSON.parse(body) as GeminiResponse).error?.message ?? "";
  } catch {
    /* body is not JSON */
  }
  const lower = msg.toLowerCase();
  if (status === 400 && (lower.includes("api key not valid") || lower.includes("api_key_invalid"))) return { code: "invalid_api_key", message: "Gemini rejected the API key.", retryable: false };
  if (status === 401 || status === 403) return { code: "invalid_api_key", message: `Gemini denied access (${redact(msg) || status}).`, retryable: false };
  if (status === 404) return { code: "model_unavailable", message: "The Gemini model was not found or is not available to this key.", retryable: false };
  if (status === 429) return { code: "rate_limited", message: "Gemini rate limit or free-tier quota reached.", retryable: true };
  if (status === 408 || status >= 500) return { code: "provider_error", message: `Gemini is temporarily unavailable (${status}).`, retryable: true };
  return { code: "provider_error", message: `Gemini returned an error: ${redact(msg) || status}`, retryable: false };
}

export class GeminiProvider extends BaseAiProvider {
  readonly id = "gemini" as const;

  private get headers(): Record<string, string> {
    return { "content-type": "application/json", "x-goog-api-key": this.apiKey };
  }

  protected async complete(request: GenerateTextRequest): Promise<AiTextResult> {
    const started = Date.now();
    const system = [request.system, ...request.messages.filter((m) => m.role === "system").map((m) => m.content)].filter(Boolean).join("\n\n");
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxOutputTokens ?? 4096,
        ...(request.json ? { responseMimeType: "application/json" } : {}),
      },
    };
    const json = (await requestJson(`${BASE}/models/${encodeURIComponent(this.model)}:generateContent`, { method: "POST", headers: this.headers, body: JSON.stringify(body) }, this.http, classify)) as GeminiResponse;

    if (json.promptFeedback?.blockReason) throw new AiError("content_blocked", `Gemini blocked the request (${json.promptFeedback.blockReason}).`);
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) {
      if (cand?.finishReason === "SAFETY" || cand?.finishReason === "PROHIBITED_CONTENT") throw new AiError("content_blocked", "Gemini blocked the response.");
      throw new AiError("bad_response", "Gemini returned an empty response.");
    }
    return {
      text,
      model: this.model,
      provider: "gemini",
      usage: { ...(json.usageMetadata?.promptTokenCount !== undefined ? { inputTokens: json.usageMetadata.promptTokenCount } : {}), ...(json.usageMetadata?.candidatesTokenCount !== undefined ? { outputTokens: json.usageMetadata.candidatesTokenCount } : {}) },
      latencyMs: Date.now() - started,
    };
  }

  async validateApiKey(): Promise<KeyValidation> {
    try {
      await requestJson(`${BASE}/models?pageSize=1`, { method: "GET", headers: this.headers }, { ...this.http, maxRetries: 1 }, classify);
      return { valid: true, message: "API key accepted. Gemini does not report remaining quota; free-tier limits depend on your Google AI Studio project." };
    } catch (e) {
      if (e instanceof AiError && (e.code === "invalid_api_key")) return { valid: false, message: e.message };
      throw e;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const json = (await requestJson(`${BASE}/models?pageSize=100`, { method: "GET", headers: this.headers }, this.http, classify)) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }[];
    };
    return (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name, free: null, ...(m.inputTokenLimit ? { contextLength: m.inputTokenLimit } : {}) }));
  }
}
