import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, completeUploadSchema, fileExtension, sniffFile } from "@querypilot/shared-validation";
import { apiError, audit, authenticate, internalError, isResponse, parseBody } from "@/lib/api";

const BUCKET = "schema-uploads";

/**
 * Step 2: after the browser has uploaded directly to Supabase Storage, verify the object really is what
 * its extension claims (magic bytes), enforce the size limit, then create the version + queued import job.
 * Parsing never happens here: it is done by the separate processing worker.
 */
export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, completeUploadSchema);
  if (isResponse(body)) return body;

  const prefix = `${ctx.user.id}/${body.projectId}/`;
  if (!body.storagePath.startsWith(prefix) || body.storagePath.includes("..")) return apiError(403, "forbidden", "That file does not belong to this project.");
  const ext = fileExtension(body.fileName);
  if (!ext) return apiError(422, "unsupported_type", "Only .dacpac and .sql files are supported.");

  try {
    const { data: signed, error } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(body.storagePath, 60);
    if (error || !signed) return apiError(404, "upload_missing", "The uploaded file could not be found. Please upload it again.");

    const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-8191" }, cache: "no-store" });
    if (!res.ok && res.status !== 206) return apiError(404, "upload_missing", "The uploaded file could not be read.");
    const head = new Uint8Array(await res.arrayBuffer());
    const total = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? head.length);

    const sniff = sniffFile(body.fileName, head);
    if (!sniff.ok || total > MAX_UPLOAD_BYTES || total <= 0) {
      await ctx.supabase.storage.from(BUCKET).remove([body.storagePath]); // secure deletion of rejected uploads
      return apiError(422, "invalid_file", sniff.error ?? `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    }

    const { data, error: rpcError } = await ctx.supabase.rpc("create_schema_version_and_job", {
      p_project_id: body.projectId,
      p_label: body.label ?? "",
      p_source_type: sniff.kind,
      p_file_name: body.fileName,
      p_file_size: total,
      p_storage_path: body.storagePath,
      p_sha256: null,
    });
    if (rpcError || !data?.[0]) {
      if (rpcError?.code === "23505") return apiError(409, "conflict", "Another import was created at the same time. Please try again.");
      return apiError(500, "job_create_failed", "Could not queue the import.");
    }
    const row = data[0] as { version_id: string; job_id: string; version_number: number };
    await audit(ctx.supabase, ctx.user.id, "schema_import.uploaded", "database_version", row.version_id, { size: total, type: sniff.kind });
    return NextResponse.json({ jobId: row.job_id, versionId: row.version_id, versionNumber: row.version_number });
  } catch (e) {
    return internalError(e, "uploads/complete");
  }
}
