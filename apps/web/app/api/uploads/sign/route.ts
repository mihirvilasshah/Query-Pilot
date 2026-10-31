import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { fileExtension, sanitizeFileName, uploadRequestSchema } from "@querypilot/shared-validation";
import { apiError, authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";

const BUCKET = "schema-uploads";

/** Step 1: validate metadata and hand out a one-time signed upload URL scoped to the caller's own folder. */
export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, uploadRequestSchema);
  if (isResponse(body)) return body;

  if (!fileExtension(body.fileName)) return apiError(422, "unsupported_type", "Only .dacpac and .sql files are supported.");
  if (!(await withinRateLimit(ctx.supabase, "upload-sign", 20, 3600))) return tooManyRequests();

  const { data: project } = await ctx.supabase.from("database_projects").select("id").eq("id", body.projectId).maybeSingle();
  if (!project) return apiError(404, "not_found", "Project not found.");

  const path = `${ctx.user.id}/${body.projectId}/${randomUUID()}-${sanitizeFileName(body.fileName)}`;
  const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return apiError(502, "storage_error", "Could not prepare the upload. Please try again.");
  return NextResponse.json({ path: data.path, token: data.token });
}
