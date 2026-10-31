import { GitCompareArrows, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/common/page";
import { RequireVersion } from "@/components/database/require-version";
import { SchemaComparisonView } from "@/components/migration/schema-comparison-view";
import { Button } from "@/components/ui/button";
import { getProjectContext, isReady } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Schema Comparison" };

export default async function SchemaComparisonPage({ searchParams }: { searchParams: Promise<{ base?: string; target?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext();
  if (!ctx.project) return (<><PageHeader title="Schema Comparison" /><RequireVersion ctx={ctx} /></>);
  const ready = ctx.versions.filter(isReady); // newest first
  if (ready.length < 2) {
    return (
      <>
        <PageHeader title="Schema Comparison" description="Compare two imported schema versions of the same project." />
        <EmptyState icon={GitCompareArrows} title="You need two schema versions" description={`“${ctx.project.name}” has ${ready.length} imported version${ready.length === 1 ? "" : "s"}. Import another version to compare.`} action={<Button asChild size="sm"><Link href="/database-intelligence/import">Import schema</Link></Button>} />
      </>
    );
  }
  const choices = ready.map((v) => ({ id: v.id, number: v.version_number, label: v.label, createdAt: v.created_at }));
  const valid = (id?: string) => ready.some((v) => v.id === id);
  const target = valid(sp.target) ? sp.target! : ready[0]!.id;
  const base = valid(sp.base) ? sp.base! : ready[1]!.id;
  return (
    <>
      <PageHeader title="Schema Comparison" description="See exactly what was added, removed and modified between two schema versions." actions={<Button asChild variant="outline" size="sm"><Link href="/migration-assistant"><Workflow className="size-4" /> Migration Assistant</Link></Button>} />
      <SchemaComparisonView projectId={ctx.project.id} versions={choices} initialBase={base} initialTarget={target} />
    </>
  );
}
