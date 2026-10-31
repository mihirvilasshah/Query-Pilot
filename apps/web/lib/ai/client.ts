export interface ApiFailure {
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure; status: number };

/** Small fetch wrapper for the app's own JSON API. Never throws; always returns a typed result. */
export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const json = (await res.json().catch(() => ({}))) as { error?: ApiFailure } & Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? { code: "error", message: "The request failed." } };
    return { ok: true, data: json as T };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, status: 0, error: { code: "aborted", message: "Cancelled." } };
    return { ok: false, status: 0, error: { code: "network", message: "Could not reach the server." } };
  }
}
