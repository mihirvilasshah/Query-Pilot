import type { Metadata } from "next";
import { PageHeader, SectionCard } from "@/components/common/page";
import { EmptyState } from "@/components/common/page";
import { SchemaUploader } from "@/components/database/schema-uploader";
import { VersionsTable } from "@/components/database/versions-table";
import { getCurrentProject, getImportJobs, getVersions } from "@/lib/data/queries";
import { FolderGit2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Import schema" };

export default async function ImportPage() {
  const project = await getCurrentProject();
  if (!project) {
    return (
      <>
        <PageHeader title="Import schema" />
        <EmptyState icon={FolderGit2} title="Create a project first" description="Schema versions are imported into a database project." action={<Button asChild size="sm"><Link href="/projects?new=1">Create project</Link></Button>} />
      </>
    );
  }
  const [versions, jobs] = await Promise.all([getVersions(project.id), getImportJobs(project.id, 50)]);
  return (
    <>
      <PageHeader title="Import schema" description={`Upload a SQL Server DACPAC or a T-SQL DDL script into “${project.name}”. Each import becomes a new schema version; nothing is overwritten.`} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><SchemaUploader projectId={project.id} projectName={project.name} /></div>
        <SectionCard title="Previous imports" className="lg:col-span-2" contentClassName="p-0">
          {versions.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No versions yet.</p> : <VersionsTable versions={versions.slice(0, 6)} jobs={jobs} projectId={project.id} />}
        </SectionCard>
      </div>
    </>
  );
}
