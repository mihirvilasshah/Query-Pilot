"use client";

import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronUp, ExternalLink, KeyRound, Link2, Maximize2, Minimize2, Search, Table2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExportMenu } from "@/components/schema/export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { layoutGraph } from "@/lib/graph-layout";
import { cn } from "@/lib/utils";

export interface ErColumn { name: string; type: string; pk: boolean; nullable: boolean | null }
export interface ErTable { id: string; schema: string; name: string; fullName: string; columns: ErColumn[] }
export interface ErRelationship { id: string; name: string | null; kind: "declared" | "inferred"; source: string; target: string; sourceColumns: string[]; targetColumns: string[] }

const COLLAPSED_ROWS = 6;
const HEADER_H = 38;
const ROW_H = 22;

interface NodeData extends Record<string, unknown> {
  table: ErTable; fkCols: string[]; expanded: boolean; dim: boolean; match: boolean; selected: boolean; onToggle: (id: string) => void;
}

function TableNode({ data }: NodeProps<Node<NodeData>>) {
  const { table, fkCols, expanded, dim, match, selected, onToggle } = data;
  const rows = expanded ? table.columns : table.columns.slice(0, COLLAPSED_ROWS);
  const fk = new Set(fkCols.map((c) => c.toLowerCase()));
  return (
    <div className={cn("w-[260px] overflow-hidden rounded-lg border bg-card text-xs shadow-sm transition-opacity", dim && "opacity-25", selected && "ring-2 ring-primary", match && !selected && "ring-2 ring-warning")} data-testid="er-node">
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-muted-foreground" />
      <div className="flex items-center gap-2 border-b bg-accent/60 px-3" style={{ height: HEADER_H }}>
        <Table2 className="size-3.5 text-primary" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight">{table.name}</span>
          {table.schema && <span className="block truncate text-[10px] leading-tight text-muted-foreground">{table.schema}</span>}
        </div>
        {table.columns.length > COLLAPSED_ROWS && (
          <button type="button" className="nodrag rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" onClick={(e) => { e.stopPropagation(); onToggle(table.id); }} aria-label={expanded ? "Collapse columns" : "Expand columns"}>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        )}
      </div>
      <ul>
        {rows.map((c) => (
          <li key={c.name} className="flex items-center gap-1.5 px-3" style={{ height: ROW_H }}>
            <span className="w-3.5 shrink-0">{c.pk ? <KeyRound className="size-3 text-warning" aria-label="Primary key" /> : fk.has(c.name.toLowerCase()) ? <Link2 className="size-3 text-chart-3" aria-label="Foreign key" /> : null}</span>
            <span className={cn("flex-1 truncate", c.pk && "font-semibold")}>{c.name}</span>
            <span className="max-w-[90px] truncate font-mono text-[10px] text-muted-foreground">{c.type}</span>
          </li>
        ))}
        {!expanded && table.columns.length > COLLAPSED_ROWS && <li className="px-3 text-[10px] text-muted-foreground" style={{ height: ROW_H }}>+ {table.columns.length - COLLAPSED_ROWS} more…</li>}
      </ul>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes: NodeTypes = { table: TableNode };

const heightOf = (t: ErTable, expanded: boolean) => HEADER_H + (expanded ? t.columns.length : Math.min(t.columns.length, COLLAPSED_ROWS) + (t.columns.length > COLLAPSED_ROWS ? 1 : 0)) * ROW_H + 2;

function Inner({ tables, relationships }: { tables: ErTable[]; relationships: ErRelationship[] }) {
  const rf = useReactFlow();
  const [query, setQuery] = useState("");
  const [schema, setSchema] = useState("all");
  const [showInferred, setShowInferred] = useState(true);
  const [showIsolated, setShowIsolated] = useState(tables.length <= 60);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const schemas = useMemo(() => [...new Set(tables.map((t) => t.schema).filter(Boolean))].sort(), [tables]);
  const rels = useMemo(() => relationships.filter((r) => showInferred || r.kind === "declared"), [relationships, showInferred]);
  const connected = useMemo(() => new Set(rels.flatMap((r) => [r.source, r.target])), [rels]);
  const fkColsByTable = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of relationships) if (r.kind === "declared") m.set(r.source, [...(m.get(r.source) ?? []), ...r.sourceColumns]);
    return m;
  }, [relationships]);

  const shownTables = useMemo(() => tables.filter((t) => (schema === "all" || t.schema === schema) && (showIsolated || connected.has(t.id))).slice(0, 250), [tables, schema, showIsolated, connected]);
  const shownIds = useMemo(() => new Set(shownTables.map((t) => t.id)), [shownTables]);
  const shownRels = useMemo(() => rels.filter((r) => shownIds.has(r.source) && shownIds.has(r.target)), [rels, shownIds]);

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const positioned = useMemo(() => {
    const sizes: Record<string, { width: number; height: number }> = {};
    const base: Node<NodeData>[] = shownTables.map((t) => {
      sizes[t.id] = { width: 260, height: heightOf(t, expanded.has(t.id)) };
      return { id: t.id, type: "table", position: { x: 0, y: 0 }, data: { table: t, fkCols: fkColsByTable.get(t.id) ?? [], expanded: expanded.has(t.id), dim: false, match: false, selected: false, onToggle: toggle } };
    });
    return layoutGraph(base, shownRels.map((r) => ({ id: r.id, source: r.source, target: r.target })), { direction: "LR", sizes, rankSep: 120, nodeSep: 30 });
  }, [shownTables, shownRels, expanded, fkColsByTable]);

  const term = query.trim().toLowerCase();
  const nodes = useMemo(() => {
    const related = new Set<string>();
    if (selectedId) {
      related.add(selectedId);
      for (const r of shownRels) { if (r.source === selectedId) related.add(r.target); if (r.target === selectedId) related.add(r.source); }
    }
    return positioned.map((n) => ({ ...n, data: { ...n.data, selected: n.id === selectedId, dim: !!selectedId && !related.has(n.id), match: !!term && n.data.table.fullName.toLowerCase().includes(term) } }));
  }, [positioned, selectedId, shownRels, term]);

  const edges: Edge[] = useMemo(() => shownRels.map((r) => {
    const incident = !selectedId || r.source === selectedId || r.target === selectedId;
    const color = r.kind === "declared" ? "var(--chart-3)" : "var(--warning)";
    return {
      id: r.id, source: r.source, target: r.target,
      label: `${r.sourceColumns.join(", ")} → ${r.targetColumns.join(", ")}${r.kind === "inferred" ? " (inferred)" : ""}`,
      type: "smoothstep",
      style: { stroke: color, strokeWidth: selectedId && incident ? 2.4 : 1.5, strokeDasharray: r.kind === "inferred" ? "5 4" : undefined, opacity: incident ? 1 : 0.1 },
      labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 }, labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 }, labelBgPadding: [4, 2] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    } satisfies Edge;
  }), [shownRels, selectedId]);

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 250 }), 60);
    return () => clearTimeout(t);
  }, [shownTables.length, schema, showIsolated, showInferred, rf]);

  const jump = () => {
    const hit = shownTables.find((t) => t.fullName.toLowerCase().includes(term));
    if (!hit) return;
    setSelectedId(hit.id);
    setTimeout(() => rf.fitView({ nodes: [{ id: hit.id }], duration: 300, padding: 1, maxZoom: 1 }), 50);
  };

  const sel = selectedId ? tables.find((t) => t.id === selectedId) : undefined;
  const selRels = selectedId ? relationships.filter((r) => r.source === selectedId || r.target === selectedId) : [];
  const nameOf = (id: string) => tables.find((t) => t.id === id)?.fullName ?? "?";

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[1fr_320px]", fullscreen && "fixed inset-0 z-50 bg-background p-4")}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && jump()} placeholder="Search tables (Enter to jump)…" className="pl-9" aria-label="Search tables" data-testid="er-search" />
          </div>
          <Select value={schema} onValueChange={setSchema}>
            <SelectTrigger className="w-40" aria-label="Schema filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All schemas</SelectItem>{schemas.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setExpanded(new Set(shownTables.map((t) => t.id)))}>Expand all</Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded(new Set())}>Collapse all</Button>
          <Button size="sm" variant="outline" onClick={() => rf.fitView({ padding: 0.15, duration: 300 })}>Fit to screen</Button>
          <ExportMenu containerId="er-flow" fileName="er-diagram" />
          <Button size="icon-sm" variant="outline" onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2"><Switch id="inferred" checked={showInferred} onCheckedChange={setShowInferred} /><Label htmlFor="inferred" className="font-normal">Show inferred relationships</Label></div>
          <div className="flex items-center gap-2"><Switch id="isolated" checked={showIsolated} onCheckedChange={setShowIsolated} /><Label htmlFor="isolated" className="font-normal">Show tables without relationships</Label></div>
          <span className="text-xs text-muted-foreground">{shownTables.length} tables · {shownRels.length} relationships</span>
        </div>
        <div id="er-flow" className={cn("overflow-hidden rounded-xl border bg-background", fullscreen ? "h-[calc(100dvh-10rem)]" : "h-[640px]")} data-testid="er-flow">
          {nodes.length === 0 ? <div className="grid h-full place-items-center text-sm text-muted-foreground">No tables to show.</div> : (
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.05} maxZoom={2} nodesConnectable={false} proOptions={{ hideAttribution: true }} fitView fitViewOptions={{ padding: 0.15 }} onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}>
              <Background gap={20} size={1} color="var(--border)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor="var(--primary)" />
            </ReactFlow>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke="var(--chart-3)" strokeWidth="2" /></svg>Declared foreign key</span>
          <span className="flex items-center gap-1.5"><svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke="var(--warning)" strokeWidth="2" strokeDasharray="5 4" /></svg>Inferred (not a real constraint)</span>
          <span className="flex items-center gap-1"><KeyRound className="size-3 text-warning" /> primary key</span>
          <span className="flex items-center gap-1"><Link2 className="size-3 text-chart-3" /> foreign key column</span>
        </div>
      </div>

      <aside className="surface h-fit max-h-[calc(100dvh-8rem)] overflow-y-auto p-4" aria-label="Table details">
        {!sel ? <p className="py-8 text-center text-sm text-muted-foreground">Select a table to inspect its definition and relationships.</p> : (
          <div className="space-y-4" data-testid="er-details">
            <div>
              <h3 className="break-words text-sm font-semibold">{sel.fullName}</h3>
              <Button asChild size="sm" variant="outline" className="mt-2"><Link href={`/database-intelligence/tables/${sel.id}`}><ExternalLink className="size-3.5" /> Full definition</Link></Button>
            </div>
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns ({sel.columns.length})</h4>
              <ul className="space-y-0.5 text-xs">
                {sel.columns.map((c) => <li key={c.name} className="flex items-center gap-1.5"><span className={cn("flex-1 truncate", c.pk && "font-semibold")}>{c.pk && <KeyRound className="mr-1 inline size-3 text-warning" />}{c.name}</span><span className="font-mono text-[10px] text-muted-foreground">{c.type}{c.nullable === false ? " NN" : ""}</span></li>)}
              </ul>
            </div>
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relationships ({selRels.length})</h4>
              {selRels.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                <ul className="space-y-1.5 text-xs">
                  {selRels.map((r) => (
                    <li key={r.id} className="rounded-md border p-2">
                      <Badge variant={r.kind === "declared" ? "success" : "warning"} className="mb-1">{r.kind === "declared" ? "Declared FK" : "Inferred"}</Badge>
                      <p>{nameOf(r.source)} ({r.sourceColumns.join(", ")}) → {nameOf(r.target)} ({r.targetColumns.join(", ")})</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export function ErDiagramView(props: { tables: ErTable[]; relationships: ErRelationship[] }) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
