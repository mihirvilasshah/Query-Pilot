import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticate, isResponse } from "@/lib/api";
import { getProjectContext } from "@/lib/data/queries";

const OBJECT_ROUTE: Record<string, string> = { table: "tables", view: "views", procedure: "procedures", function: "functions" };

/** Escape LIKE wildcards so user input is always treated literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function GET(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const q = z.string().trim().min(2).max(80).safeParse(new URL(request.url).searchParams.get("q"));
  if (!q.success) return apiError(422, "validation_failed", "Query must be 2-80 characters.");
  const pattern = `%${likeEscape(q.data)}%`;

  const { project, version } = await getProjectContext();
  const hits: { kind: string; id: string; label: string; href: string }[] = [];

  if (version) {
    const { data } = await ctx.supabase
      .from("database_objects")
      .select("id,schema_name,name,object_type")
      .eq("version_id", version.id)
      .neq("object_type", "schema")
      .ilike("name", pattern)
      .order("name")
      .limit(15);
    for (const o of data ?? []) {
      const route = OBJECT_ROUTE[o.object_type as string];
      hits.push({
        kind: o.object_type,
        id: o.id,
        label: o.schema_name ? `${o.schema_name}.${o.name}` : o.name,
        href: route ? `/database-intelligence/${route}/${o.id}` : `/database-intelligence/triggers?q=${encodeURIComponent(o.name)}`,
      });
    }
  }

  let scripts = ctx.supabase.from("sql_scripts").select("id,name").ilike("name", pattern).order("updated_at", { ascending: false }).limit(5);
  if (project) scripts = scripts.or(`project_id.eq.${project.id},project_id.is.null`);
  const { data: scriptRows } = await scripts;
  for (const s of scriptRows ?? []) hits.push({ kind: "script", id: s.id, label: s.name, href: `/sql-workspace?script=${s.id}` });

  return NextResponse.json({ hits });
}
