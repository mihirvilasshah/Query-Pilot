import { Braces } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/common/page";
import { DbHeader } from "@/components/database/db-header";
import { RequireVersion } from "@/components/database/require-version";
import { ErDiagramView, type ErRelationship, type ErTable } from "@/components/schema/er-diagram";
import { getProjectContext, getSnapshot } from "@/lib/data/queries";
import { formatDataType } from "@querypilot/database-core";

export const metadata: Metadata = { title: "ER diagram" };

export default async function ErDiagramPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext(sp.v);
  if (!ctx.project || !ctx.version) return (<><DbHeader ctx={ctx} title="ER diagram" /><RequireVersion ctx={ctx} /></>);
  const snap = await getSnapshot(ctx.version.id, false);
  const tableObjs = snap.objects.filter((o) => o.type === "table");
  const tables: ErTable[] = tableObjs.map((o) => ({
    id: o.id, schema: o.schema, name: o.name, fullName: o.schema ? `${o.schema}.${o.name}` : o.name,
    columns: o.columns.map((c) => ({ name: c.name, type: formatDataType(c), pk: c.primaryKey, nullable: c.nullable })),
  }));
  const ids = new Set(tables.map((t) => t.id));
  const relationships: ErRelationship[] = snap.relationships
    .filter((r) => r.targetObjectId && ids.has(r.sourceObjectId) && ids.has(r.targetObjectId))
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, source: r.sourceObjectId, target: r.targetObjectId!, sourceColumns: r.sourceColumns, targetColumns: r.targetColumns }));
  return (
    <>
      <DbHeader ctx={ctx} title="ER diagram" description="Tables, keys and relationships. Only explicitly declared foreign keys are drawn as solid lines; name-based inferences are dashed and clearly labelled." />
      {tables.length === 0 ? <EmptyState icon={Braces} title="No tables in this version" /> : <ErDiagramView tables={tables} relationships={relationships} />}
    </>
  );
}
