import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness probe. Reports configuration presence only, never values. */
export function GET() {
  return NextResponse.json({ status: "ok", supabaseConfigured: isSupabaseConfigured() });
}
