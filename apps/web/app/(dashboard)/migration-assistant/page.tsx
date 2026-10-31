import { Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/common/page";
import { RequireVersion } from "@/components/database/require-version";
import { MigrationView } from "@/components/migration/migration-view";
import { Button } from "@/components/ui/button";
import { getProjectContext, isReady } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Migration Assistant" };

export default async function MigrationAssistantPage({ searchParams }: { searchParams: Promise<{ base?: string; target?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext();
  if (!ctx.project) return (<><PageHeader title="Migration Assistant" /><RequireVersion ctx={ctx} /></>);
  const ready = ctx.versions.filter(isReady);
  if (ready.length < 2) {
    return (
      <>
        <PageHeader title="Migration Assistant" description="Plan a migration between two imported schema versions." />
        <EmptyState icon={Workflow} title="You need two schema versions" description="Import a second version of this database to plan a migration between them." action={<Button asChild size="sm"><Link href="/database-intelligence/import">Import schema</Link></Button>} />
      </>
    );
  }
  const choices = ready.map((v) => ({ id: v.id, number: v.version_number, label: v.label, createdAt: v.created_at }));
  const valid = (id?: string) => ready.some((v) => v.id === id);
  return (
    <>
      <PageHeader title="Migration Assistant" description="Migration SQL, rollback suggestions, pre/post validation queries and a checklist - generated for review, never executed." />
      <MigrationView projectId={ctx.project.id} versions={choices} initialBase={valid(sp.base) ? sp.base! : ready[1]!.id} initialTarget={valid(sp.target) ? sp.target! : ready[0]!.id} />
    </>
  );
}
