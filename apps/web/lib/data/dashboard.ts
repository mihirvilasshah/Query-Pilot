import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getProjects, getVersions, isReady } from "@/lib/data/queries";
import type { HistoryRow, ImportJobRow, ProjectRow, VersionRow } from "@/lib/data/types";

export interface DashboardStats {
  projects: number;
  schema_versions: number;
  tables: number;
  procedures: number;
  scripts: number;
  analyses: number;
  ai_interactions: number;
}

export interface RecentProject {
  project: ProjectRow;
  latestVersion: VersionRow | null;
  versionCount: number;
  lastImportedAt: string | null;
}

export interface ActivityItem {
  id: string;
  kind: "import" | "comparison" | "analysis" | "ai" | "migration" | "other";
  title: string;
  detail?: string;
  at: string;
  href?: string;
}

export interface AiUsageSummary {
  requests30d: number;
  success30d: number;
  failed30d: number;
  lastModel: string | null;
  lastProvider: string | null;
}

export const getDashboardStats = cache(async (): Promise<DashboardStats> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_stats");
  if (error || !data) return { projects: 0, schema_versions: 0, tables: 0, procedures: 0, scripts: 0, analyses: 0, ai_interactions: 0 };
  return data as DashboardStats;
});

export async function getRecentProjects(limit = 5): Promise<RecentProject[]> {
  const projects = (await getProjects()).slice(0, limit);
  return Promise.all(
    projects.map(async (project) => {
      const versions = await getVersions(project.id);
      const ready = versions.filter(isReady);
      return { project, latestVersion: ready[0] ?? null, versionCount: versions.length, lastImportedAt: ready[0]?.created_at ?? null };
    }),
  );
}

const HISTORY_KIND: Record<string, ActivityItem["kind"]> = {
  schema_comparison: "comparison",
  sql_analyze: "analysis",
  sql_explain: "ai",
  sql_generate: "ai",
  sql_optimize: "ai",
  ai_conversation: "ai",
  migration_plan: "migration",
  documentation: "other",
};

export async function getRecentActivity(limit = 12): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const [history, jobs] = await Promise.all([
    supabase.from("query_history").select("id,operation,title,created_at").order("created_at", { ascending: false }).limit(limit),
    supabase.from("database_import_jobs").select("id,status,file_name,created_at,project_id").order("created_at", { ascending: false }).limit(limit),
  ]);
  const items: ActivityItem[] = [];
  for (const h of (history.data ?? []) as Pick<HistoryRow, "id" | "operation" | "title" | "created_at">[]) {
    items.push({ id: `h-${h.id}`, kind: HISTORY_KIND[h.operation] ?? "other", title: h.title, at: h.created_at, href: "/history" });
  }
  for (const j of (jobs.data ?? []) as Pick<ImportJobRow, "id" | "status" | "file_name" | "created_at" | "project_id">[]) {
    items.push({ id: `j-${j.id}`, kind: "import", title: `Imported ${j.file_name}`, detail: j.status.replaceAll("_", " "), at: j.created_at, href: "/database-intelligence/versions" });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function getAiUsage(): Promise<AiUsageSummary> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase.from("ai_requests").select("provider,model,status,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
  const rows = (data ?? []) as { provider: string; model: string; status: string }[];
  return {
    requests30d: rows.length,
    success30d: rows.filter((r) => r.status === "success").length,
    failed30d: rows.filter((r) => r.status !== "success").length,
    lastModel: rows[0]?.model ?? null,
    lastProvider: rows[0]?.provider ?? null,
  };
}
