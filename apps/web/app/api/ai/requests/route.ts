import { NextResponse } from "next/server";
import { apiError, authenticate, isResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Recent AI request metadata for the Settings → AI history table. Prompts and responses are never stored. */
export async function GET() {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { data, error } = await ctx.supabase
    .from("ai_requests")
    .select("id,provider,model,operation,status,latency_ms,error_code,created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) {
    console.error("[ai] load request history failed", error.message);
    return apiError(500, "load_failed", "Could not load request history.");
  }
  return NextResponse.json({ requests: data ?? [] });
}
