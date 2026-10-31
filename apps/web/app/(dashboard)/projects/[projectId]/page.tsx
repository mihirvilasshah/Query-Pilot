import { PlugZap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState, PageHeader, SectionCard } from "@/components/common/page";
import { DeleteProjectButton } from "@/components/database/delete-project-button";
import { ProjectForm } from "@/components/database/project-form";
import { VersionsTable } from "@/components/database/versions-table";
import { Button } from "@/components/ui/button";
import { getImportJobs, getProjects, getVersions } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = (await getProjects()).find((p) => p.id === projectId);
  if (!project) notFound();
  const [versions, jobs] = await Promise.all([getVersions(projectId), getImportJobs(projectId, 50)]);

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description ?? "No description yet."}
        actions={
          <>
            <Button asChild size="sm"><Link href="/database-intelligence/import"><PlugZap className="size-4" /> Import schema</Link></Button>
            <DeleteProjectButton projectId={project.id} name={project.name} />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Schema versions & import history" className="lg:col-span-2" contentClassName="p-0">
          {versions.length === 0 ? (
            <div className="p-4"><EmptyState icon={PlugZap} title="No schema imported" description="Upload a .dacpac or .sql DDL script. Existing versions are never overwritten." action={{ label: "Import schema", href: "/database-intelligence/import" }} /></div>
          ) : (
            <VersionsTable versions={versions} jobs={jobs} projectId={project.id} />
          )}
        </SectionCard>
        <SectionCard title="Project details">
          <ProjectForm project={project} />
        </SectionCard>
      </div>
    </>
  );
}
