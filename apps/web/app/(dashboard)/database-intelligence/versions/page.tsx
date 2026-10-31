import type { Metadata } from "next";
import { PageHeader, SectionCard } from "@/components/common/page";
import { EmptyState } from "@/components/common/page";
import { VersionsTable } from "@/components/database/versions-table";
import { getCurrentProject, getImportJobs, getVersions } from "@/lib/data/queries";
import { Activity, PlugZap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RequireVersion } from "@/components/database/require-version";

export const metadata: Metadata = { title: "Schema versions" };

export default async function VersionsPage() {
  const project = await getCurrentProject();
  if (!project) return <RequireVersion ctx={{ project: null, versions: [], version: null }} />;
  const [versions, jobs] = await Promise.all([getVersions(project.id), getImportJobs(project.id, 100)]);
  return (
    <>
      <PageHeader title="Schema versions" description={`Every import into “${project.name}” is kept as an immutable version.`} actions={<Button asChild size="sm"><Link href="/database-intelligence/import"><PlugZap className="size-4" /> Import new version</Link></Button>} />
      <SectionCard contentClassName="p-0">
        {versions.length === 0 ? <div className="p-4"><EmptyState icon={Activity} title="No versions yet" description="Import a DACPAC or SQL file to create version 1." action={{ label: "Import schema", href: "/database-intelligence/import" }} /></div> : <VersionsTable versions={versions} jobs={jobs} projectId={project.id} />}
      </SectionCard>
    </>
  );
}
