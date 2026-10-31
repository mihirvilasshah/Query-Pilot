import type { Metadata } from "next";
import { AiExplainPanel } from "@/components/ai/ai-explain-panel";
import { ColumnsTable, DependencyList } from "@/components/database/detail-parts";
import { DetailHeader, loadDetail } from "@/components/database/detail-header";
import { SqlViewer } from "@/components/sql/monaco-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "View" };

export default async function ViewDetailPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  const d = await loadDetail(objectId, "view");
  const o = d.object;
  const refs = d.outgoing;
  const tableRefs = refs.filter((r) => r.target_object_id && d.nameById[r.target_object_id]?.type === "table");
  const viewRefs = refs.filter((r) => r.target_object_id && d.nameById[r.target_object_id]?.type === "view");
  const rest = refs.filter((r) => !tableRefs.includes(r) && !viewRefs.includes(r));
  return (
    <>
      <DetailHeader detail={d} backHref="/database-intelligence/views" backLabel="All views" />
      <Tabs defaultValue="definition">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="definition">Definition</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="usedby">Used by</TabsTrigger>
          <TabsTrigger value="ai">AI explanation</TabsTrigger>
        </TabsList>
        <TabsContent value="definition">{o.definition ? <SqlViewer value={o.definition} maxHeight={640} /> : <Alert><AlertDescription>The original definition was not captured by the import.</AlertDescription></Alert>}</TabsContent>
        <TabsContent value="references" className="space-y-5">
          <DependencyList title="Referenced tables" deps={tableRefs} names={d.nameById} direction="out" />
          <DependencyList title="Referenced views" deps={viewRefs} names={d.nameById} direction="out" />
          {rest.length > 0 && <DependencyList title="Other / unresolved references" deps={rest} names={d.nameById} direction="out" />}
        </TabsContent>
        <TabsContent value="columns"><div className="surface"><ColumnsTable columns={d.columns} fkColumns={new Set()} /></div></TabsContent>
        <TabsContent value="usedby"><DependencyList title="Objects that use this view" deps={d.incoming} names={d.nameById} direction="in" /></TabsContent>
        <TabsContent value="ai"><AiExplainPanel objectId={o.id} noun="view" /></TabsContent>
      </Tabs>
    </>
  );
}
