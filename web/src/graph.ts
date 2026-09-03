/**
 * Where the diamonds go and what shape the wires between them are. Pure: it
 * takes what the read answered and gives back numbers, so the drawing in
 * `graph.tsx` has no geometry in it and this has no DOM in it.
 *
 * `@dagrejs/dagre` does the ranking — left to right, a blocker always left of
 * what it blocks — and nothing else. Its edge points are ignored: dagre routes
 * around dummy nodes with splines, and this house draws orthogonal steps
 * (DESIGN.md §6), so the path is computed here from the two node centres and
 * the gap between their ranks.
 */
import dagre from '@dagrejs/dagre';
import { isOpenBlocker, type GraphEdge, type GraphNode } from '@goblin/shared';

/** The box dagre reserves for a node: the diamond, its key beside it and the clipped title beneath. */
export const NODE_W = 200;
export const NODE_H = 46;
/** Half a diamond's diagonal — the shape is a square on its point, 2R across. */
export const DIAMOND = 7;
/**
 * How far down the box the diamond's centre sits. An edge leaves and arrives
 * at that height, so the key is set above the line and the title below it —
 * a wire through a key reads as a strikethrough, which in this house means
 * something else entirely (DESIGN.md §3).
 */
export const LABEL_TOP = 16;
/** Between ranks (the columns) and between nodes inside one (the rows). */
const RANK_GAP = 60;
const NODE_GAP = 20;
const MARGIN = 12;
/** The popover has the whole title; the diamond gets as much as fits beside it. */
const TITLE_MAX = 26;

/** A title cut to the node's width, with the ellipsis inside the budget. */
export const clipTitle = (title: string) => (title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`);

/** A node with its diamond's centre — not its box's, so an edge drawn to `x, y` lands on the shape. */
export interface LaidNode extends GraphNode {
  x: number;
  y: number;
}

/** One wire: the path to stroke, and whether the blocker is still in the way (dashed) or satisfied (solid). */
export interface LaidEdge extends GraphEdge {
  path: string;
  open: boolean;
}

export interface Layout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  width: number;
  height: number;
}

/**
 * `nodes` are inserted in the order given, and where nothing else decides
 * where one goes — a ticket with no edges — that is the order down the page,
 * so the read's key order is the drawing's. Where edges do decide, dagre's
 * ordering pass does, from the same input to the same output every time.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Layout {
  const known = new Map(nodes.map((n) => [n.key, n]));
  // an edge naming something not drawn (a cancelled end, a stale cache) is not a crash
  const drawn = edges.filter((e) => known.has(e.blocker) && known.has(e.blocked));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: RANK_GAP, nodesep: NODE_GAP, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.key, { width: NODE_W, height: NODE_H });
  for (const e of drawn) g.setEdge(e.blocker, e.blocked);
  dagre.layout(g);

  /** dagre's box centre; the diamond sits at the box's top-left, where the label hangs off it. */
  const box = (key: string) => g.node(key) as { x: number; y: number };
  const diamond = (key: string) => {
    const { x, y } = box(key);
    return { x: x - NODE_W / 2 + DIAMOND, y: y - NODE_H / 2 + LABEL_TOP };
  };

  const laid: LaidEdge[] = drawn.map((e) => {
    const from = diamond(e.blocker);
    const to = diamond(e.blocked);
    // the turn is the middle of the gap that follows the blocker's rank — every edge leaving a
    // rank shares that vertical line, which is what makes a fan of them read as one comb
    const turn = box(e.blocker).x + NODE_W / 2 + RANK_GAP / 2;
    return {
      ...e,
      path: `M ${from.x} ${from.y} H ${turn} V ${to.y} H ${to.x}`,
      open: isOpenBlocker(known.get(e.blocker)!.status),
    };
  });

  const { width = 0, height = 0 } = g.graph();
  return { nodes: nodes.map((n) => ({ ...n, ...diamond(n.key) })), edges: laid, width, height };
}
