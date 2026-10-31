import type { Metadata } from "next";
import type { ProcedureParameter } from "@querypilot/shared-types";
import { procedureFlowchart } from "@querypilot/database-core";
import { AiExplainPanel } from "@/components/ai/ai-explain-panel";
import { DependencyList } from "@/components/database/detail-parts";
import { DetailHeader, loadDetail } from "@/components/database/detail-header";
import { MermaidDiagram } from "@/components/database/mermaid-diagram";
import { ParametersTable, RoutineFacts } from "@/components/database/routine-parts";
import { SqlViewer } from "@/components/sql/monaco-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Stored procedure" };

export default async function ProcedureDetailPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  const d = await loadDetail(objectId, "procedure");
  const o = d.object;
  const md = o.metadata as { parameters?: ProcedureParameter[]; hasDynamicSql?: boolean };
  const out = d.outgoing;
  const byKind = (k: string[], types?: string[]) => out.filter((x) => k.includes(x.kind) && (!types || (x.target_object_id ? types.includes(d.nameById[x.target_object_id]?.type ?? "") : types.includes("unresolved"))));
  const tablesRead = out.filter((x) => x.kind === "reads");
  const tablesWritten = out.filter((x) => x.kind === "writes");
  const calls = byKind(["executes"]);
  const funcs = byKind(["calls_function"]);
  const others = out.filter((x) => x.kind === "references");
  const flow = o.definition ? procedureFlowchart({ id: o.id, schema: o.schema_name, name: o.name, type: "procedure", definition: o.definition, metadata: {}, columns: [] }) : "";

  return (
    <>
      <DetailHeader detail={d} backHref="/database-intelligence/procedures" backLabel="All procedures"
        badges={<><Badge variant="outline">{md.parameters?.length ?? 0} parameters</Badge>{tablesWritten.length > 0 && <Badge variant="danger">modifies {tablesWritten.length}</Badge>}{md.hasDynamicSql && <Badge variant="warning">dynamic SQL</Badge>}</>} />
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
          <TabsTrigger value="flow">Flowchart</TabsTrigger>
          <TabsTrigger value="usedby">Used by</TabsTrigger>
          <TabsTrigger value="ai">AI explanation</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
          <RoutineFacts object={o} detail={d} />
          <div><h3 className="mb-2 text-sm font-semibold">Parameters</h3><ParametersTable parameters={md.parameters ?? []} /></div>
        </TabsContent>
        <TabsContent value="references" className="space-y-5">
          <DependencyList title="Tables & views read" deps={tablesRead} names={d.nameById} direction="out" />
          <DependencyList title="Tables modified" deps={tablesWritten} names={d.nameById} direction="out" />
          <DependencyList title="Procedures executed (incl. dynamic SQL)" deps={calls} names={d.nameById} direction="out" />
          <DependencyList title="Functions called" deps={funcs} names={d.nameById} direction="out" />
          {others.length > 0 && <DependencyList title="Other references" deps={others} names={d.nameById} direction="out" />}
        </TabsContent>
        <TabsContent value="definition">{o.definition ? <SqlViewer value={o.definition} maxHeight={640} /> : <Alert><AlertDescription>The original definition was not captured by the import.</AlertDescription></Alert>}</TabsContent>
        <TabsContent value="flow" className="space-y-3">
          {flow ? (
            <>
              <div className="surface p-4"><MermaidDiagram chart={flow} /></div>
              <p className="text-xs text-muted-foreground">Statement flow derived by the deterministic SQL analyser (sequential order; branches are shown as decision nodes but not expanded). Dynamic SQL is shown as a single opaque step.</p>
            </>
          ) : <Alert><AlertDescription>A flowchart needs the original definition, which is not available.</AlertDescription></Alert>}
        </TabsContent>
        <TabsContent value="usedby"><DependencyList title="Objects that execute this procedure" deps={d.incoming} names={d.nameById} direction="in" /></TabsContent>
        <TabsContent value="ai"><AiExplainPanel objectId={o.id} noun="procedure" /></TabsContent>
      </Tabs>
    </>
  );
}
