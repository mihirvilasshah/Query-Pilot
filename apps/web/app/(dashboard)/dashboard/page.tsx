import {
  Activity, ArrowUpRight, Boxes, BrainCircuit, CircleCheck, CircleX, FileCode2, FileSearch, FolderGit2, GitCompareArrows, History,
  PlugZap, Sparkles, Table2, Workflow, Wand2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, SectionCard, StatCard } from "@/components/common/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveAiConfig } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth";
import { getAiUsage, getDashboardStats, getRecentActivity, getRecentProjects, type ActivityItem } from "@/lib/data/dashboard";
import { formatDate, timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { DATABASE_PLATFORMS } from "@querypilot/shared-types";
import { PROVIDER_LABELS } from "@querypilot/ai-core";

export const metadata: Metadata = { title: "Dashboard" };

const QUICK_ACTIONS = [
  { label: "Import Database Schema", href: "/database-intelligence/import", icon: PlugZap },
  { label: "Explain SQL", href: "/ai-assistant?mode=explain", icon: Sparkles },
  { label: "Analyze SQL", href: "/sql-analyzer", icon: FileSearch },
  { label: "Generate SQL", href: "/ai-assistant?mode=generate", icon: Wand2 },
  { label: "Compare Schemas", href: "/schema-comparison", icon: GitCompareArrows },
  { label: "Explore Database", href: "/database-intelligence", icon: Boxes },
  { label: "Ask AI", href: "/database-intelligence/assistant", icon: BrainCircuit },
];

const ACTIVITY_ICON: Record<ActivityItem["kind"], typeof Activity> = {
  import: PlugZap, comparison: GitCompareArrows, analysis: FileSearch, ai: Sparkles, migration: Workflow, other: History,
};

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [stats, projects, activity, usage, ai] = await Promise.all([
    getDashboardStats(),
    getRecentProjects(5),
    getRecentActivity(10),
    getAiUsage(),
    resolveAiConfig({ supabase, user }),
  ]);
  const platformLabel = (p: string) => DATABASE_PLATFORMS.find((x) => x.value === p)?.label ?? p;
  const aiStatus = { ready: ["success", "Ready"], needs_consent: ["warning", "Needs consent"], not_configured: ["muted", "Not configured"] } as const;
  const [badgeVariant, badgeLabel] = aiStatus[ai.config.status];

  return (
    <>
      <PageHeader title="Dashboard" description="Everything here is computed from your stored projects, imports and analyses." actions={<Button asChild size="sm"><Link href="/projects?new=1">New project</Link></Button>} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-7">
        <StatCard label="Database Projects" value={stats.projects} icon={FolderGit2} />
        <StatCard label="Schema Versions" value={stats.schema_versions} icon={Activity} hint="successfully imported" />
        <StatCard label="Tables" value={stats.tables} icon={Table2} hint="latest version per project" />
        <StatCard label="Stored Procedures" value={stats.procedures} icon={Workflow} hint="latest version per project" />
        <StatCard label="SQL Scripts" value={stats.scripts} icon={FileCode2} />
        <StatCard label="Analyses" value={stats.analyses} icon={FileSearch} />
        <StatCard label="AI Interactions" value={stats.ai_interactions} icon={Sparkles} hint="successful requests" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <SectionCard title="Recent projects" className="lg:col-span-2" actions={<Button asChild variant="ghost" size="sm"><Link href="/projects">View all</Link></Button>} contentClassName="p-0">
          {projects.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={FolderGit2} title="No projects yet" description="Create a project, then import a DACPAC or SQL DDL script to start exploring." action={{ label: "Create a project", href: "/projects?new=1" }} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Project</th>
                    <th className="px-4 py-2 font-medium">Version</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Objects</th>
                    <th className="hidden px-4 py-2 font-medium lg:table-cell">Last imported</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {projects.map(({ project, latestVersion, lastImportedAt }) => {
                    const c = latestVersion?.summary.counts;
                    return (
                      <tr key={project.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <Link href={`/projects/${project.id}`} className="font-medium hover:underline">{project.name}</Link>
                          <p className="text-xs text-muted-foreground">{platformLabel(project.platform)}</p>
                        </td>
                        <td className="px-4 py-3">{latestVersion ? <Badge variant="secondary">v{latestVersion.version_number}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">{c ? `${c.tables} tables · ${c.procedures} procs · ${c.views} views` : "No import yet"}</td>
                        <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(lastImportedAt)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{timeAgo(project.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Quick actions" contentClassName="grid gap-1.5 p-3">
          {QUICK_ACTIONS.map(({ label, href, icon: Icon }) => (
            <Link key={label} href={href} className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
              <span className="grid size-7 place-items-center rounded-md bg-secondary text-muted-foreground group-hover:bg-background"><Icon className="size-4" /></span>
              <span className="flex-1">{label}</span>
              <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ))}
        </SectionCard>

        <SectionCard title="Recent activity" className="lg:col-span-2" contentClassName="p-0">
          {activity.length === 0 ? (
            <div className="p-4"><EmptyState icon={History} title="No activity yet" description="Imports, comparisons, analyses and AI conversations will show up here." /></div>
          ) : (
            <ul className="divide-y">
              {activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.kind];
                return (
                  <li key={a.id}>
                    <Link href={a.href ?? "/history"} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Icon className="size-3.5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{a.title}</span>
                        {a.detail && <span className="text-xs capitalize text-muted-foreground">{a.detail}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="AI usage" actions={<Badge variant={badgeVariant}>{badgeLabel}</Badge>}>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Provider</dt><dd className="font-medium">{PROVIDER_LABELS[ai.config.provider]}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Model</dt><dd className="truncate font-mono text-xs">{ai.config.model}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">API key</dt><dd>{ai.config.keySource === "user" ? "Saved (encrypted)" : ai.config.keySource === "environment" ? "Server environment" : "Missing"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Requests (30 days)</dt><dd className="tabular-nums">{usage.requests30d}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground flex items-center gap-1"><CircleCheck className="size-3.5 text-success" /> Succeeded</dt><dd className="tabular-nums">{usage.success30d}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground flex items-center gap-1"><CircleX className="size-3.5 text-destructive" /> Failed</dt><dd className="tabular-nums">{usage.failed30d}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Remaining quota is not shown: providers do not expose it for free tiers, and QueryPilot never estimates it.</p>
          {ai.config.status !== "ready" && (
            <Button asChild variant="outline" size="sm" className="mt-3 w-full"><Link href="/settings?tab=ai">Configure AI</Link></Button>
          )}
        </SectionCard>
      </div>
    </>
  );
}
