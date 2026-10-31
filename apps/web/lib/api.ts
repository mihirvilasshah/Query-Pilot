import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export interface AuthedContext {
  supabase: ServerSupabase;
  user: User;
}

/** Authenticates an API request. Returns a NextResponse when the caller must stop. */
export async function authenticate(): Promise<AuthedContext | NextResponse> {
  if (!isSupabaseConfigured()) return apiError(503, "not_configured", "Supabase is not configured.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(401, "unauthorized", "You must be signed in.");
  return { supabase, user };
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;

/** Parses and validates a JSON body with zod; never echoes internal details back. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(400, "invalid_json", "The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return apiError(422, "validation_failed", parsed.error.issues[0]?.message ?? "Invalid input.", {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

/** Fixed-window rate limit backed by PostgreSQL (works across serverless instances). */
export async function withinRateLimit(supabase: ServerSupabase, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) return true; // fail open: availability over strictness if the limiter itself is unavailable
  return data === true;
}

export const tooManyRequests = () => apiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");

/** Maps unexpected exceptions to a safe response and logs the detail server-side only. */
export function internalError(e: unknown, context: string) {
  console.error(`[api:${context}]`, e instanceof Error ? e.message : e);
  return apiError(500, "internal_error", "Something went wrong. Please try again.");
}

export async function audit(supabase: ServerSupabase, userId: string, action: string, entityType?: string, entityId?: string, details: Record<string, unknown> = {}) {
  await supabase.from("audit_logs").insert({ owner_id: userId, action, entity_type: entityType ?? null, entity_id: entityId ?? null, details });
}
