import type { AiProviderId } from "@querypilot/shared-types";

/**
 * Suggested starting models. These are NOT authoritative and are never hardcoded elsewhere:
 * - the application reads defaults from environment variables (AI_DEFAULT_PROVIDER / AI_*_MODEL),
 * - the Settings page fetches the live model list from the provider and lets the user pick.
 * Free-tier availability and limits change often; always verify with the provider.
 */
export const SUGGESTED_MODELS: Record<AiProviderId, { id: string; note: string }[]> = {
  gemini: [
    { id: "gemini-2.5-flash", note: "Google AI Studio free tier (rate limited)" },
    { id: "gemini-2.5-flash-lite", note: "Google AI Studio free tier (higher limits)" },
    { id: "gemini-2.0-flash", note: "Google AI Studio free tier" },
  ],
  openrouter: [
    { id: "meta-llama/llama-3.3-70b-instruct:free", note: "OpenRouter free variant" },
    { id: "deepseek/deepseek-chat-v3-0324:free", note: "OpenRouter free variant" },
    { id: "qwen/qwen3-coder:free", note: "OpenRouter free variant, code oriented" },
    { id: "openrouter/free", note: "OpenRouter auto-router limited to free models" },
  ],
};

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};
