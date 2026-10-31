import { FolderGit2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/common/page";
import { NewProjectDialog } from "@/components/database/new-project-dialog";
import { Badge } from "@/components/ui/badge";
import { getRecentProjects } from "@/lib/data/dashboard";
import { getCurrentProject } from "@/lib/data/queries";
import { formatDate, timeAgo } from "@/lib/format";
import { DATABASE_PLATFORMS } from "@querypilot/shared-types";

export const metadata: Metadata = { title: "Saved Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const [projects, current] = await Promise.all([getRecentProjects(200), getCurrentProject()]);
  return (
    <>
      <PageHeader title="Saved Projects" description="Each project is one logical database with its own schema versions, scripts and analyses." actions={<NewProjectDialog defaultOpen={sp.new === "1"} />} />
      {projects.length === 0 ? (
        <EmptyState icon={FolderGit2} title="No projects yet" description="Create your first project to start importing schema versions." action={<NewProjectDialog />} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="project-list">
          {projects.map(({ project, latestVersion, versionCount, lastImportedAt }) => {
            const c = latestVersion?.summary.counts;
            return (
              <Link key={project.id} href={`/projects/${project.id}`} className="surface group flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold group-hover:text-primary">{project.name}</h3>
                    <p className="text-xs text-muted-foreground">{DATABASE_PLATFORMS.find((p) => p.value === project.platform)?.label}</p>
                  </div>
                  {current?.id === project.id && <Badge variant="info">Current</Badge>}
                </div>
                {project.description && <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                  <span>{versionCount} version{versionCount === 1 ? "" : "s"}</span>
                  {c && <span>{c.tables} tables · {c.procedures} procs</span>}
                  <span className="ml-auto">{lastImportedAt ? `Imported ${formatDate(lastImportedAt)}` : `Updated ${timeAgo(project.updated_at)}`}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
