"use client";

import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Layers, Maximize2, Minimize2, Network, Search, SquareFunction, Table2, Workflow, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DependencyConfidence } from "@querypilot/shared-types";
import { DEPENDENCY_CONFIDENCE_LABELS } from "@querypilot/shared-types";
import { ExportMenu } from "@/components/schema/export-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { layoutGraph } from "@/lib/graph-layout";
import { cn } from "@/lib/utils";

export interface GNode { id: string; type: string; schema: string; name: string; fullName: string; hasDynamicSql: boolean }
export interface GEdge { id: string; source: string; target: string; kind: string; confidence: DependencyConfidence; origin: string; operations: string[]; label: string }
export interface GUnresolved { sourceId: string; targetName: string; kind: string; confidence: DependencyConfidence; note: string | null }

const TYPE_ICON: Record<string, typeof Table2> = { table: Table2, view: Layers, procedure: Workflow, function: SquareFunction, trigger: Zap };
const TYPE_COLOR: Record<string, string> = { table: "var(--chart-1)", view: "var(--chart-2)", procedure: "var(--chart-4)", function: "var(--chart-6)", trigger: "var(--chart-5)" };
const ROUTE: Record<string, string> = { table: "tables", view: "views", procedure: "procedures", function: "functions" };

const EDGE_COLOR: Record<string, string> = {
  writes: "var(--destructive)", reads: "var(--info)", executes: "var(--primary)", calls_function: "var(--chart-6)",
  foreign_key: "var(--chart-3)", trigger_on: "var(--warning)", references: "var(--muted-foreground)",
};
const DASH: Record<DependencyConfidence, string | undefined> = { confirmed_static: undefined, parsed_reference: "7 4", inferred: "2 4", unresolved_dynamic: "1 5" };

interface NodeData extends Record<string, unknown> { g: GNode; dim: boolean; selected: boolean; match: boolean }

function ObjectNode({ data }: NodeProps<Node<NodeData>>) {
  const { g, dim, selected, match } = data;
  const Icon = TYPE_ICON[g.type] ?? Table2;
  return (
    <div
      className={cn("w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-opacity", dim && "opacity-25", selected && "ring-2 ring-primary", match && !selected && "ring-2 ring-warning")}
      style={{ borderLeft: `4px solid ${TYPE_COLOR[g.type] ?? "var(--border)"}` }}
      data-testid="graph-node"
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium leading-tight">{g.name}</p>
          <p className="truncate text-[10.5px] leading-tight text-muted-foreground">{g.schema ? `${g.schema} · ` : ""}{g.type}</p>
        </div>
        {g.hasDynamicSql && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Contains dynamic SQL" />}
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes: NodeTypes = { object: ObjectNode };
const INITIAL_LIMIT = 30;

function Inner({ nodes: gNodes, edges: gEdges, unresolved, caveat }: { nodes: GNode[]; edges: GEdge[]; unresolved: GUnresolved[]; caveat: string | null }) {
  const rf = useReactFlow();
  const byId = useMemo(() => new Map(gNodes.map((n) => [n.id, n])), [gNodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of gEdges) { d.set(e.source, (d.get(e.source) ?? 0) + 1); d.set(e.target, (d.get(e.target) ?? 0) + 1); }
    return d;
  }, [gEdges]);

  const [visible, setVisible] = useState<Set<string>>(() => {
    if (gNodes.length <= 80) return new Set(gNodes.map((n) => n.id));
    return new Set([...gNodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, INITIAL_LIMIT).map((n) => n.id));
  });
  const [types, setTypes] = useState<Set<string>>(new Set(["table", "view", "procedure", "function", "trigger"]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<"both" | "incoming" | "outgoing">("both");
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  const shownIds = useMemo(() => new Set([...visible].filter((id) => types.has(byId.get(id)?.type ?? ""))), [visible, types, byId]);
  const shownEdges = useMemo(() => gEdges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target)), [gEdges, shownIds]);

  const positioned = useMemo(() => {
    const base: Node<NodeData>[] = [...shownIds].map((id) => ({ id, type: "object", position: { x: 0, y: 0 }, data: { g: byId.get(id)!, dim: false, selected: false, match: false } }));
    return layoutGraph(base, shownEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })), { direction: "LR" });
  }, [shownIds, shownEdges, byId]);

  const term = query.trim().toLowerCase();
  const nodes: Node<NodeData>[] = useMemo(() => {
    const related = new Set<string>();
    if (selectedId) {
      related.add(selectedId);
      for (const e of shownEdges) {
        if (e.source === selectedId && highlight !== "incoming") related.add(e.target);
        if (e.target === selectedId && highlight !== "outgoing") related.add(e.source);
      }
    }
    return positioned.map((n) => ({ ...n, selected: n.id === selectedId, data: { ...n.data, selected: n.id === selectedId, dim: !!selectedId && !related.has(n.id), match: !!term && n.data.g.fullName.toLowerCase().includes(term) } }));
  }, [positioned, selectedId, highlight, shownEdges, term]);

  const edges: Edge[] = useMemo(
    () =>
      shownEdges.map((e) => {
        const incident = !selectedId || (e.source === selectedId && highlight !== "incoming") || (e.target === selectedId && highlight !== "outgoing");
        const color = EDGE_COLOR[e.kind] ?? "var(--muted-foreground)";
        return {
          id: e.id, source: e.source, target: e.target, label: e.label.length > 28 ? `${e.label.slice(0, 26)}…` : e.label,
          animated: !!selectedId && incident && (e.source === selectedId || e.target === selectedId),
          style: { stroke: color, strokeWidth: selectedId && incident ? 2.2 : 1.4, strokeDasharray: DASH[e.confidence], opacity: incident ? 1 : 0.12 },
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
          labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        } satisfies Edge;
      }),
    [shownEdges, selectedId, highlight],
  );

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 250 }), 50);
    return () => clearTimeout(t);
  }, [positioned, rf]);

  const neighbors = useCallback((id: string): string[] => gEdges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])), [gEdges]);

  const expand = (id: string) => setVisible((v) => new Set([...v, ...neighbors(id)]));
  const collapse = (id: string) =>
    setVisible((v) => {
      const next = new Set(v);
      for (const nb of neighbors(id)) {
        const others = neighbors(nb).filter((x) => x !== id && next.has(x));
        if (others.length === 0) next.delete(nb);
      }
      return next;
    });

  const search = (value: string) => {
    setQuery(value);
    const t = value.trim().toLowerCase();
    if (t.length < 2) return;
    const hits = gNodes.filter((n) => n.fullName.toLowerCase().includes(t));
    if (!hits.length) return;
    setVisible((v) => new Set([...v, ...hits.slice(0, 10).map((h) => h.id)]));
  };
  const jumpToFirstMatch = () => {
    const t = query.trim().toLowerCase();
    const hit = gNodes.find((n) => n.fullName.toLowerCase().includes(t));
    if (!hit) return;
    setSelectedId(hit.id);
    setTimeout(() => rf.fitView({ nodes: [{ id: hit.id }], duration: 300, maxZoom: 1.1, padding: 0.8 }), 60);
  };

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const sel = selectedId
    ? { incoming: gEdges.filter((e) => e.target === selectedId), outgoing: gEdges.filter((e) => e.source === selectedId), unresolved: unresolved.filter((u) => u.sourceId === selectedId) }
    : null;
  const hidden = gNodes.length - visible.size;

  return (
    <div className={cn("grid gap-4", fullscreen ? "fixed inset-0 z-50 bg-background p-4 lg:grid-cols-[1fr_320px]" : "lg:grid-cols-[1fr_320px]")}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => search(e.target.value)} onKeyDown={(e) => e.key === "Enter" && jumpToFirstMatch()} placeholder="Search objects (Enter to jump)…" className="pl-9" aria-label="Search graph" data-testid="graph-search" />
          </div>
          {(["table", "view", "procedure", "function", "trigger"] as const).map((t) => (
            <Button key={t} size="sm" variant={types.has(t) ? "secondary" : "outline"} aria-pressed={types.has(t)} onClick={() => setTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; })} className="capitalize">
              <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{t}s
            </Button>
          ))}
          <ExportMenu containerId="dependency-flow" fileName="dependency-graph" />
          <Button size="icon-sm" variant="outline" onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
        </div>

        {caveat && <Alert className="border-warning/40 bg-warning/10"><AlertTriangle className="size-4 text-warning" /><AlertDescription>{caveat}</AlertDescription></Alert>}
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            Showing {visible.size} of {gNodes.length} objects. Search, or select a node and choose “Expand”, to bring in more.
            {gNodes.length <= 400 && <> <button className="font-medium text-primary hover:underline" onClick={() => setVisible(new Set(gNodes.map((n) => n.id)))}>Show all</button></>}
          </p>
        )}

        <div id="dependency-flow" className={cn("overflow-hidden rounded-xl border bg-background", fullscreen ? "h-[calc(100dvh-9rem)]" : "h-[620px]")} data-testid="dependency-flow">
          {nodes.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">No objects match the current filters.</div>
          ) : (
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.1} maxZoom={2} nodesConnectable={false} proOptions={{ hideAttribution: true }} fitView fitViewOptions={{ padding: 0.2 }}
              onNodeClick={(_, n) => setSelectedId(n.id)} onNodeDoubleClick={(_, n) => expand(n.id)} onPaneClick={() => setSelectedId(null)}
            >
              <Background gap={20} size={1} color="var(--border)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => TYPE_COLOR[(n.data as NodeData).g.type] ?? "var(--muted)"} />
            </ReactFlow>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Legend">
          {(Object.keys(DEPENDENCY_CONFIDENCE_LABELS) as DependencyConfidence[]).map((c) => (
            <span key={c} className="flex items-center gap-1.5">
              <svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray={DASH[c]} /></svg>
              {DEPENDENCY_CONFIDENCE_LABELS[c]}
            </span>
          ))}
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "var(--destructive)" }} />writes</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "var(--info)" }} />reads</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "var(--primary)" }} />executes</span>
        </div>
      </div>

      <aside className="surface h-fit max-h-[calc(100dvh-8rem)] overflow-y-auto p-4" aria-label="Object details">
        {!selected ? (
          <div className="py-8 text-center text-sm text-muted-foreground"><Network className="mx-auto mb-2 size-6" />Select a node to inspect its dependencies. Double-click to expand.</div>
        ) : (
          <div className="space-y-4" data-testid="graph-details">
            <div>
              <Badge variant="secondary" className="mb-1.5 capitalize">{selected.type}</Badge>
              <h3 className="break-words text-sm font-semibold">{selected.fullName}</h3>
              {selected.hasDynamicSql && <p className="mt-1 flex items-center gap-1 text-xs text-warning-foreground dark:text-warning"><AlertTriangle className="size-3" /> Contains dynamic SQL — references may be incomplete.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {ROUTE[selected.type] && <Button asChild size="sm" variant="outline"><Link href={`/database-intelligence/${ROUTE[selected.type]}/${selected.id}`}><ExternalLink className="size-3.5" /> Definition</Link></Button>}
              <Button size="sm" variant="outline" onClick={() => expand(selected.id)}>Expand</Button>
              <Button size="sm" variant="outline" onClick={() => collapse(selected.id)}>Collapse</Button>
            </div>
            <div className="flex gap-1" role="group" aria-label="Highlight direction">
              {([["both", "Both"], ["incoming", "Incoming"], ["outgoing", "Outgoing"]] as const).map(([v, l]) => (
                <Button key={v} size="xs" variant={highlight === v ? "secondary" : "ghost"} onClick={() => setHighlight(v)}>{v === "incoming" ? <ArrowDownToLine /> : v === "outgoing" ? <ArrowUpFromLine /> : null}{l}</Button>
              ))}
            </div>
            {sel && (
              <>
                <EdgeList title={`Outgoing (${sel.outgoing.length})`} edges={sel.outgoing} side="target" byId={byId} onPick={setSelectedId} />
                <EdgeList title={`Incoming (${sel.incoming.length})`} edges={sel.incoming} side="source" byId={byId} onPick={setSelectedId} />
                {sel.unresolved.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unresolved ({sel.unresolved.length})</h4>
                    <ul className="space-y-1.5 text-xs">
                      {sel.unresolved.map((u, i) => (
                        <li key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                          <span className="font-mono">{u.targetName}</span> <span className="text-muted-foreground">({u.kind})</span>
                          {u.note && <p className="mt-0.5 text-muted-foreground">{u.note}</p>}
                          <p className="mt-0.5 text-destructive">{DEPENDENCY_CONFIDENCE_LABELS[u.confidence]}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function EdgeList({ title, edges, side, byId, onPick }: { title: string; edges: GEdge[]; side: "source" | "target"; byId: Map<string, GNode>; onPick: (id: string) => void }) {
  if (!edges.length) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-1">
        {edges.slice(0, 40).map((e) => {
          const other = byId.get(e[side]);
          return (
            <li key={e.id}>
              <button type="button" className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => other && onPick(other.id)}>
                <span className="truncate font-medium">{other?.fullName ?? "?"}</span>
                <span className="text-muted-foreground">{e.kind.replace("_", " ")}{e.operations.length ? ` · ${e.operations.join(", ")}` : ""} · {DEPENDENCY_CONFIDENCE_LABELS[e.confidence]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DependencyGraphView(props: { nodes: GNode[]; edges: GEdge[]; unresolved: GUnresolved[]; caveat: string | null }) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
