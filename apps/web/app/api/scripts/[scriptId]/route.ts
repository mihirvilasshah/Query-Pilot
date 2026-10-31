import { NextResponse } from "next/server";
import { z } from "zod";
import { scriptInputSchema } from "@querypilot/shared-validation";
import { apiError, authenticate, internalError, isResponse, parseBody } from "@/lib/api";

const idSchema = z.uuid();
const updateSchema = scriptInputSchema.partial().extend({ changeNote: z.string().max(200).optional() });

export async function GET(_req: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { scriptId } = await params;
  if (!idSchema.safeParse(scriptId).success) return apiError(400, "invalid_id", "Invalid script id.");
  const { data } = await ctx.supabase.from("sql_scripts").select("*").eq("id", scriptId).maybeSingle();
  if (!data) return apiError(404, "not_found", "Script not found.");
  return NextResponse.json({ script: data });
}

export async function PUT(request: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { scriptId } = await params;
  if (!idSchema.safeParse(scriptId).success) return apiError(400, "invalid_id", "Invalid script id.");
  const body = await parseBody(request, updateSchema);
  if (isResponse(body)) return body;
  try {
    const { data: current } = await ctx.supabase.from("sql_scripts").select("name,content").eq("id", scriptId).maybeSingle();
    if (!current) return apiError(404, "not_found", "Script not found.");
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.content !== undefined) patch.content = body.content;
    if (body.dialect !== undefined) patch.dialect = body.dialect;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.category !== undefined) patch.category = body.category;
    if (body.projectId !== undefined) patch.project_id = body.projectId;
    if (body.isFavorite !== undefined) patch.is_favorite = body.isFavorite;
    const { data, error } = await ctx.supabase.from("sql_scripts").update(patch).eq("id", scriptId).select("*").single();
    if (error || !data) return apiError(500, "update_failed", "Could not save the script.");

    // every content or name change becomes a new immutable version
    if ((body.content !== undefined && body.content !== current.content) || (body.name !== undefined && body.name !== current.name)) {
      const { data: last } = await ctx.supabase.from("sql_script_versions").select("version_number").eq("script_id", scriptId).order("version_number", { ascending: false }).limit(1).maybeSingle();
      await ctx.supabase.from("sql_script_versions").insert({
        owner_id: ctx.user.id, script_id: scriptId, version_number: (last?.version_number ?? 0) + 1, name: data.name, content: data.content,
        change_note: body.changeNote ?? (body.content !== undefined && body.content !== current.content ? "Edited" : "Renamed"),
      });
    }
    return NextResponse.json({ script: data });
  } catch (e) {
    return internalError(e, "scripts/update");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const { scriptId } = await params;
  if (!idSchema.safeParse(scriptId).success) return apiError(400, "invalid_id", "Invalid script id.");
  const { error } = await ctx.supabase.from("sql_scripts").delete().eq("id", scriptId);
  if (error) return apiError(500, "delete_failed", "Could not delete the script.");
  return NextResponse.json({ ok: true });
}
