import { AiError } from "./errors";

export interface HttpOptions {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Called after every attempt (success or failure) - used for request logging, never receives bodies. */
  onAttempt?: (info: { attempt: number; status: number | null; error?: string }) => void;
}

export const defaultHttpOptions = (overrides: Partial<HttpOptions> = {}): HttpOptions => ({
  timeoutMs: 45_000,
  maxRetries: 3,
  baseDelayMs: 800,
  fetchImpl: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  ...overrides,
});

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.min(Math.max(d - Date.now(), 0), 30_000);
}

export interface ClassifyResult {
  code: AiError["code"];
  message: string;
  retryable: boolean;
}

/** Fetches JSON with timeout, retry (exponential backoff + jitter, honouring Retry-After) and error normalisation. */
export async function requestJson(
  url: string,
  init: RequestInit,
  opts: HttpOptions,
  classify: (status: number, body: string) => ClassifyResult,
): Promise<unknown> {
  let lastError: AiError | undefined;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let retryAfter: number | undefined;
    try {
      const res = await opts.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      opts.onAttempt?.({ attempt, status: res.status });
      if (res.ok) {
        try {
          return JSON.parse(text) as unknown;
        } catch (cause) {
          throw new AiError("bad_response", "The provider returned invalid JSON.", { cause });
        }
      }
      retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const c = classify(res.status, text);
      lastError = new AiError(c.code, c.message, { status: res.status, retryable: c.retryable, ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}) });
    } catch (e) {
      if (e instanceof AiError && !e.retryable) throw e;
      if (e instanceof AiError) {
        lastError = e;
      } else if (e instanceof Error && e.name === "AbortError") {
        opts.onAttempt?.({ attempt, status: null, error: "timeout" });
        lastError = new AiError("timeout", "The AI provider timed out.", { retryable: true, cause: e });
      } else {
        opts.onAttempt?.({ attempt, status: null, error: "network" });
        lastError = new AiError("network_error", "Network error while calling the AI provider.", { retryable: true, cause: e });
      }
    } finally {
      clearTimeout(timer);
    }

    if (!lastError.retryable || attempt === opts.maxRetries) throw lastError;
    const backoff = opts.baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * opts.baseDelayMs * 0.5;
    await opts.sleep(Math.max(retryAfter ?? 0, backoff + jitter));
  }
  throw lastError ?? new AiError("provider_error", "Unknown AI provider failure.");
}
