import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDocumentation } from "@querypilot/database-core";
import { DATABASE_PLATFORMS } from "@querypilot/shared-types";
import { apiError, authenticate, internalError, isResponse } from "@/lib/api";
import { recordHistory } from "@/lib/ai/context";
import { getSnapshot } from "@/lib/data/queries";

/** Deterministic Markdown documentation for one schema version, downloaded as a file. */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { versionId } = await params;
  if (!z.uuid().safeParse(versionId).success) return apiError(400, "invalid_id", "Invalid version id.");
  try {
    const { data: v } = await ctx.supabase.from("database_versions").select("id,project_id,version_number,label,created_at,status").eq("id", versionId).maybeSingle();
    if (!v) return apiError(404, "not_found", "Version not found.");
    if (v.status !== "ready" && v.status !== "ready_with_warnings") return apiError(409, "not_ready", "This version has not finished importing.");
    const { data: p } = await ctx.supabase.from("database_projects").select("name,platform").eq("id", v.project_id).maybeSingle();
    const snapshot = await getSnapshot(versionId, true);
    const md = generateDocumentation({
      projectName: p?.name ?? "Database", platform: DATABASE_PLATFORMS.find((x) => x.value === p?.platform)?.label ?? "SQL", snapshot,
      versionLabel: `v${v.version_number}${v.label ? ` - ${v.label}` : ""}`, importedAt: v.created_at,
    });
    await recordHistory(ctx, { operation: "documentation", projectId: v.project_id, title: `Documentation for ${p?.name ?? "database"} v${v.version_number}`, refId: versionId });
    const safe = (p?.name ?? "database").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60);
    return new NextResponse(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${safe}-v${v.version_number}.md"`, "cache-control": "no-store" } });
  } catch (e) {
    return internalError(e, "docs");
  }
}
