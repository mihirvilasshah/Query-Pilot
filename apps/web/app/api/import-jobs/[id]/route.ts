import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticate, isResponse } from "@/lib/api";

const JOB_FIELDS = "id,status,stage,progress,file_name,error_code,error_message,warnings,attempts,max_attempts,version_id";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(400, "invalid_id", "Invalid job id.");
  const { data } = await ctx.supabase.from("database_import_jobs").select(JOB_FIELDS).eq("id", id).maybeSingle();
  if (!data) return apiError(404, "not_found", "Import job not found.");
  return NextResponse.json({ job: data }, { headers: { "cache-control": "no-store" } });
}
