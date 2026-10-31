export type AiErrorCode =
  | "not_configured"
  | "invalid_api_key"
  | "rate_limited"
  | "timeout"
  | "model_unavailable"
  | "paid_model_blocked"
  | "content_blocked"
  | "bad_response"
  | "provider_error"
  | "network_error";

/** Every failure from an AI provider is normalised to this type; messages are safe to show to the user. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(code: AiErrorCode, message: string, opts: { status?: number; retryable?: boolean; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "AiError";
    this.code = code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export const isAiError = (e: unknown): e is AiError => e instanceof AiError;

export function userMessageFor(e: unknown): string {
  if (!isAiError(e)) return "The AI request failed unexpectedly. Deterministic features are unaffected.";
  switch (e.code) {
    case "not_configured": return "No AI provider is configured. Add an API key in Settings → AI to enable AI features.";
    case "invalid_api_key": return "The AI provider rejected the API key. Check the key in Settings → AI.";
    case "rate_limited": return "The AI provider rate limit or free-tier quota was reached. Wait a moment and try again, or pick another model.";
    case "timeout": return "The AI provider did not answer in time. Try again.";
    case "model_unavailable": return "The selected model is unavailable. Choose another model in Settings → AI.";
    case "paid_model_blocked": return "This model is not free. QueryPilot never switches to paid models automatically; enable paid models explicitly in settings if you want to use it.";
    case "content_blocked": return "The provider blocked this request or response (safety filter).";
    case "bad_response": return "The AI returned a response QueryPilot could not use. Try again or choose another model.";
    case "network_error": return "Could not reach the AI provider.";
    default: return "The AI provider returned an error.";
  }
}
