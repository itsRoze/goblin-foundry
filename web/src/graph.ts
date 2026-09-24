/** Pure graph geometry and reachability; the renderer owns interaction and color. */
import dagre from '@dagrejs/dagre';
import { isOpenBlocker, type GraphEdge, type GraphNode } from '@goblin/shared';

export const NODE_W = 68;
export const NODE_H = 28;
export const DIAMOND = 3;
export const LABEL_TOP = 14;
const RANK_GAP = 48;
const NODE_GAP = 48;
const MARGIN = 12;

type Point = { x: number; y: number };
export interface LaidNode extends GraphNode { x: number; y: number; width: number }
export interface LaidEdge extends GraphEdge { path: string; open: boolean }
export interface Layout { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number }

/** Smooth each reserved lane with tangents along the flow direction. */
function routedPath(points: Point[], vertical: boolean): string {
  const first = points[0]!;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const mid = vertical ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    path += vertical ? ` C ${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y}` : ` C ${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
  }
  return path;
}

/** Trace each direction separately: a sibling branch is not an ancestor or descendant. */
export function traceGraph(key: string | null, edges: GraphEdge[]) {
  const walk = (reverse: boolean) => {
    const nodes = new Set<string>();
    const paths = new Set<string>();
    const pending = key ? [key] : [];
    const visited = new Set(pending);
    while (pending.length) {
      const current = pending.pop()!;
      for (const e of edges) {
        if ((reverse ? e.blocked : e.blocker) !== current) continue;
        const next = reverse ? e.blocker : e.blocked;
        paths.add(`${e.blocker}>${e.blocked}`);
        if (!visited.has(next)) { visited.add(next); nodes.add(next); pending.push(next); }
      }
    }
    return { nodes, paths };
  };
  return { upstream: walk(true), downstream: walk(false) };
}

export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], vertical = false): Layout {
  const known = new Map(nodes.map((n) => [n.key, n]));
  const drawn = edges.filter((e) => known.has(e.blocker) && known.has(e.blocked));
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: vertical ? 'TB' : 'LR', ranksep: vertical ? 28 : RANK_GAP + 24, nodesep: vertical ? 16 : NODE_GAP, edgesep: 12, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  const nodeWidth = (key: string) => Math.max(NODE_W, key.length * 9 + 22);
  for (const n of nodes) g.setNode(n.key, { width: nodeWidth(n.key), height: NODE_H });
  for (const e of drawn) g.setEdge(e.blocker, e.blocked);
  dagre.layout(g);
  const box = (key: string) => g.node(key) as Point;
  const laid = drawn.map((e) => {
    const from = box(e.blocker);
    const to = box(e.blocked);
    const routed = g.edge(e.blocker, e.blocked).points as Point[];
    // Dagre reserves lanes around intervening nodes, including edges spanning many ranks.
    // Fixed side ports keep every connection out of ticket labels.
    const port = (incoming: boolean) => {
      const connections = drawn.filter((wire) => incoming ? wire.blocked === e.blocked : wire.blocker === e.blocker)
        .sort((a, b) => {
          const first = box(incoming ? a.blocker : a.blocked);
          const second = box(incoming ? b.blocker : b.blocked);
          return vertical ? first.x - second.x : first.y - second.y;
        });
      const index = connections.indexOf(e);
      const spread = vertical ? nodeWidth(incoming ? e.blocked : e.blocker) - 24 : NODE_H - 12;
      return connections.length > 1 ? (index / (connections.length - 1) - 0.5) * spread : 0;
    };
    const start = vertical ? { x: from.x + port(false), y: from.y + NODE_H / 2 } : { x: from.x + nodeWidth(e.blocker) / 2, y: from.y + port(false) };
    const end = vertical ? { x: to.x + port(true), y: to.y - NODE_H / 2 } : { x: to.x - nodeWidth(e.blocked) / 2, y: to.y + port(true) };
    // Adjacent ranks get one unbroken curve. Longer wires follow Dagre's empty lanes.
    const points = routed.length <= 3 ? [start, end] : [start, ...routed.slice(1, -1), end];
    return { ...e, path: routedPath(points, vertical), open: isOpenBlocker(known.get(e.blocker)!.status) };
  });
  const { width = 0, height = 0 } = g.graph();
  return { nodes: nodes.map((n) => ({ ...n, width: nodeWidth(n.key), x: box(n.key).x - nodeWidth(n.key) / 2, y: box(n.key).y - NODE_H / 2 })), edges: laid, width, height };
}
