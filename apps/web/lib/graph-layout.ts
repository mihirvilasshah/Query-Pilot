import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

export interface LayoutOptions {
  direction?: "LR" | "TB";
  nodeSep?: number;
  rankSep?: number;
  /** Node sizes by id (defaults to 220x56). */
  sizes?: Record<string, { width: number; height: number }>;
}

/** Positions nodes with dagre. Pure: returns new node objects with `position` set. */
export function layoutGraph<N extends Node>(nodes: N[], edges: Edge[], options: LayoutOptions = {}): N[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: options.direction ?? "LR", nodesep: options.nodeSep ?? 36, ranksep: options.rankSep ?? 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const s = options.sizes?.[n.id] ?? { width: 220, height: 56 };
    g.setNode(n.id, { width: s.width, height: s.height });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const s = options.sizes?.[n.id] ?? { width: 220, height: 56 };
    return { ...n, position: { x: (p?.x ?? 0) - s.width / 2, y: (p?.y ?? 0) - s.height / 2 } };
  });
}
