import { Network } from "lucide-react";
import type { Metadata } from "next";
import { buildDependencyGraph } from "@querypilot/database-core";
import { EmptyState } from "@/components/common/page";
import { DbHeader } from "@/components/database/db-header";
import { RequireVersion } from "@/components/database/require-version";
import { DependencyGraphView } from "@/components/schema/dependency-graph";
import { getProjectContext, getSnapshot } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Dependency explorer" };

export default async function DependenciesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext(sp.v);
  if (!ctx.project || !ctx.version) return (<><DbHeader ctx={ctx} title="Dependency explorer" /><RequireVersion ctx={ctx} /></>);
  const snapshot = await getSnapshot(ctx.version.id, false);
  const graph = buildDependencyGraph(snapshot);
  return (
    <>
      <DbHeader ctx={ctx} title="Dependency explorer" description="Relationships between tables, views, procedures, functions and triggers. Each link records how it was found and how confident that finding is." />
      {graph.nodes.length === 0 ? (
        <EmptyState icon={Network} title="No objects to graph" />
      ) : (
        <DependencyGraphView nodes={graph.nodes} edges={graph.edges} unresolved={graph.unresolved} caveat={graph.completenessCaveat} />
      )}
    </>
  );
}
