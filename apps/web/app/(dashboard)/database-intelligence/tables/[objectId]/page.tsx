import type { Metadata } from "next";
import { AiExplainPanel } from "@/components/ai/ai-explain-panel";
import { ColumnImpactPanel } from "@/components/database/column-impact-panel";
import { ColumnsTable, DependencyList, IndexesAndConstraints, RelationshipsList } from "@/components/database/detail-parts";
import { DetailHeader, loadDetail } from "@/components/database/detail-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SqlViewer } from "@/components/sql/monaco-editor";
import { reconstructCreateTable } from "@/lib/reconstruct";

export const metadata: Metadata = { title: "Table" };

export default async function TableDetailPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  const d = await loadDetail(objectId, "table");
  const o = d.object;
  const fkCols = new Set(d.outgoingRelationships.filter((r) => r.kind === "declared").flatMap((r) => r.source_columns.map((c) => c.toLowerCase())));
  const pk = d.columns.filter((c) => c.is_primary_key).map((c) => c.name);
  const referencedBy = d.incoming.filter((x) => x.kind !== "trigger_on");
  const triggers = d.incoming.filter((x) => x.kind === "trigger_on");

  return (
    <>
      <DetailHeader
        detail={d}
        backHref="/database-intelligence/tables"
        backLabel="All tables"
        badges={<><Badge variant="outline">{d.columns.length} columns</Badge>{pk.length > 0 && <Badge variant="outline">PK ({pk.join(", ")})</Badge>}<Badge variant="outline">{d.outgoingRelationships.length} FK out · {d.incomingRelationships.length} in</Badge></>}
      />
      <Tabs defaultValue="columns">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="indexes">Indexes & constraints</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="impact">Impact analysis</TabsTrigger>
          <TabsTrigger value="ai">AI explanation</TabsTrigger>
        </TabsList>
        <TabsContent value="columns"><div className="surface"><ColumnsTable columns={d.columns} fkColumns={fkCols} /></div></TabsContent>
        <TabsContent value="definition" className="space-y-3">
          {o.definition ? <SqlViewer value={o.definition} /> : (
            <>
              <Alert><AlertDescription>The importer did not capture the original CREATE TABLE text for this table. The statement below is <strong>reconstructed from metadata</strong>; it omits foreign keys, indexes and other constraints and is not the original definition.</AlertDescription></Alert>
              <SqlViewer value={reconstructCreateTable(o.schema_name, o.name, d.columns)} />
            </>
          )}
        </TabsContent>
        <TabsContent value="relationships"><RelationshipsList outgoing={d.outgoingRelationships} incoming={d.incomingRelationships} names={d.nameById} selfId={o.id} /></TabsContent>
        <TabsContent value="indexes"><IndexesAndConstraints indexes={d.indexes} constraints={d.constraints} /></TabsContent>
        <TabsContent value="dependencies" className="space-y-5">
          <DependencyList title="Objects that reference this table" deps={referencedBy} names={d.nameById} direction="in" />
          {triggers.length > 0 && <DependencyList title="Triggers on this table" deps={triggers} names={d.nameById} direction="in" />}
        </TabsContent>
        <TabsContent value="impact"><ColumnImpactPanel objectId={o.id} columns={d.columns.map((c) => c.name)} /></TabsContent>
        <TabsContent value="ai"><AiExplainPanel objectId={o.id} noun="table" /></TabsContent>
      </Tabs>
    </>
  );
}
