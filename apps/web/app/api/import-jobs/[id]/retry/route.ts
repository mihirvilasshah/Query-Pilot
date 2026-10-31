import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, audit, authenticate, isResponse } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return apiError(400, "invalid_id", "Invalid job id.");
  // retry_import_job verifies ownership and that the job is in the failed state
  const { error } = await ctx.supabase.rpc("retry_import_job", { p_job_id: id });
  if (error) return apiError(409, "not_retryable", "This import cannot be retried.");
  await audit(ctx.supabase, ctx.user.id, "schema_import.retried", "database_import_job", id);
  return NextResponse.json({ ok: true });
}
