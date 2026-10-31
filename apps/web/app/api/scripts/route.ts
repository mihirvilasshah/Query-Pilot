import { NextResponse } from "next/server";
import { z } from "zod";
import { scriptInputSchema } from "@querypilot/shared-validation";
import { apiError, authenticate, internalError, isResponse, parseBody } from "@/lib/api";

const likeEscape = (s: string) => s.replace(/[\\%_,()]/g, " ");
const createSchema = scriptInputSchema.extend({ duplicateOf: z.uuid().optional() });

const LIST_FIELDS = "id,project_id,name,description,dialect,tags,category,is_favorite,created_at,updated_at";

export async function GET(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const sp = new URL(request.url).searchParams;
  let q = ctx.supabase.from("sql_scripts").select(LIST_FIELDS).order("updated_at", { ascending: false }).limit(300);
  const project = sp.get("project");
  if (project && z.uuid().safeParse(project).success) q = q.eq("project_id", project);
  if (sp.get("fav") === "1") q = q.eq("is_favorite", true);
  const tag = sp.get("tag");
  if (tag) q = q.contains("tags", [tag.slice(0, 40)]);
  const category = sp.get("category");
  if (category) q = q.eq("category", category.slice(0, 60));
  const term = sp.get("q")?.trim();
  if (term) q = q.or(`name.ilike.%${likeEscape(term).slice(0, 80)}%,description.ilike.%${likeEscape(term).slice(0, 80)}%`);
  const { data, error } = await q;
  if (error) return apiError(500, "query_failed", "Could not load scripts.");
  return NextResponse.json({ scripts: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, createSchema);
  if (isResponse(body)) return body;
  try {
    let input = body;
    if (body.duplicateOf) {
      const { data: src } = await ctx.supabase.from("sql_scripts").select("*").eq("id", body.duplicateOf).maybeSingle();
      if (!src) return apiError(404, "not_found", "Script not found.");
      input = { ...body, name: `${src.name} (copy)`.slice(0, 200), content: src.content, dialect: src.dialect, tags: src.tags, category: src.category, description: src.description, projectId: src.project_id, isFavorite: false };
    }
    const { data, error } = await ctx.supabase
      .from("sql_scripts")
      .insert({ owner_id: ctx.user.id, project_id: input.projectId ?? null, name: input.name, description: input.description ?? null, content: input.content, dialect: input.dialect, tags: input.tags, category: input.category ?? null, is_favorite: input.isFavorite })
      .select(`${LIST_FIELDS},content`)
      .single();
    if (error || !data) return apiError(500, "create_failed", "Could not save the script.");
    await ctx.supabase.from("sql_script_versions").insert({ owner_id: ctx.user.id, script_id: data.id, version_number: 1, name: data.name, content: data.content, change_note: body.duplicateOf ? "Duplicated" : "Created" });
    return NextResponse.json({ script: data }, { status: 201 });
  } catch (e) {
    return internalError(e, "scripts/create");
  }
}
