import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticate, isResponse } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { scriptId } = await params;
  if (!z.uuid().safeParse(scriptId).success) return apiError(400, "invalid_id", "Invalid script id.");
  const { data, error } = await ctx.supabase.from("sql_script_versions").select("id,version_number,name,content,change_note,created_at").eq("script_id", scriptId).order("version_number", { ascending: false }).limit(100);
  if (error) return apiError(500, "query_failed", "Could not load versions.");
  return NextResponse.json({ versions: data ?? [] });
}
