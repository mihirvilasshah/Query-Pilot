import type { Metadata } from "next";
import type { ProcedureParameter } from "@querypilot/shared-types";
import { AiExplainPanel } from "@/components/ai/ai-explain-panel";
import { ColumnsTable, DependencyList } from "@/components/database/detail-parts";
import { DetailHeader, loadDetail } from "@/components/database/detail-header";
import { ParametersTable, RoutineFacts } from "@/components/database/routine-parts";
import { SqlViewer } from "@/components/sql/monaco-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Function" };

export default async function FunctionDetailPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  const d = await loadDetail(objectId, "function");
  const o = d.object;
  const md = o.metadata as { parameters?: ProcedureParameter[] };
  return (
    <>
      <DetailHeader detail={d} backHref="/database-intelligence/functions" backLabel="All functions" />
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="ai">AI explanation</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
          <RoutineFacts object={o} detail={d} />
          <div><h3 className="mb-2 text-sm font-semibold">Parameters</h3><ParametersTable parameters={md.parameters ?? []} /></div>
          {d.columns.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Returned table columns</h3><div className="surface"><ColumnsTable columns={d.columns} fkColumns={new Set()} /></div></div>}
        </TabsContent>
        <TabsContent value="references"><DependencyList title="Objects referenced by this function" deps={d.outgoing} names={d.nameById} direction="out" /></TabsContent>
        <TabsContent value="definition">{o.definition ? <SqlViewer value={o.definition} maxHeight={640} /> : <Alert><AlertDescription>The original definition was not captured by the import.</AlertDescription></Alert>}</TabsContent>
        <TabsContent value="usage" className="space-y-3">
          <DependencyList title="Objects that call this function" deps={d.incoming} names={d.nameById} direction="in" />
          <p className="text-xs text-muted-foreground">Usage is only what is statically detectable in imported definitions; application code is not visible.</p>
        </TabsContent>
        <TabsContent value="ai"><AiExplainPanel objectId={o.id} noun="function" /></TabsContent>
      </Tabs>
    </>
  );
}
