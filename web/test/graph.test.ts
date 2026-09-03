import { describe, expect, test } from 'bun:test';
import type { GraphEdge, GraphNode } from '@goblin/shared';
import { NODE_H, clipTitle, layoutGraph } from '../src/graph';

const node = (key: string, over: Partial<GraphNode> = {}): GraphNode => ({
  key,
  title: `the ${key} ticket`,
  status: 'backlog',
  blocked_by: [],
  description_line: '',
  ...over,
});
const edge = (blocker: string, blocked: string): GraphEdge => ({ blocker, blocked });
const at = (layout: ReturnType<typeof layoutGraph>, key: string) => layout.nodes.find((n) => n.key === key)!;

/**
 * The layout is the half of the drawing that can be judged without eyes: rank
 * order (a blocker is always to the left of what it waits on), the shape of an
 * edge (three segments, always), and that the same graph lays out the same way
 * twice.
 */
describe('layoutGraph', () => {
  test('a blocker is always to the left of what it blocks, however the input is ordered', () => {
    const nodes = [node('GF-3'), node('GF-1'), node('GF-2')];
    const edges = [edge('GF-1', 'GF-2'), edge('GF-2', 'GF-3'), edge('GF-1', 'GF-3')];
    const layout = layoutGraph(nodes, edges);

    for (const e of edges) expect(at(layout, e.blocker).x).toBeLessThan(at(layout, e.blocked).x);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  test('an edge is three segments: out, across the gap between the ranks, and in', () => {
    const layout = layoutGraph([node('GF-1'), node('GF-2')], [edge('GF-1', 'GF-2')]);
    const [drawn] = layout.edges;
    const from = at(layout, 'GF-1');
    const to = at(layout, 'GF-2');

    // `M x y H x V y H x` — from one diamond's centre to the other's, turning once
    expect(drawn!.path).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+$/);
    const [x1, y1, xm, y2, x2] = drawn!.path.split(' ').filter((p) => !/^[MHV]$/.test(p)).map(Number);
    expect([x1, y1, x2, y2]).toEqual([from.x, from.y, to.x, to.y]);
    // the turn is in the whitespace between the two ranks, not on top of either node
    expect(xm!).toBeGreaterThan(from.x);
    expect(xm!).toBeLessThan(to.x);
  });

  test('an edge is open while its blocker is, and satisfied once the blocker is done', () => {
    const layout = layoutGraph(
      [node('GF-1'), node('GF-2', { status: 'done' }), node('GF-3'), node('GF-4')],
      [edge('GF-1', 'GF-3'), edge('GF-2', 'GF-4')],
    );
    expect(layout.edges.map((e) => [e.blocker, e.open])).toEqual([
      ['GF-1', true],
      ['GF-2', false],
    ]);
  });

  test('tickets with no edges are one rank of diamonds, spread down the page', () => {
    const layout = layoutGraph([node('GF-1'), node('GF-2'), node('GF-3')], []);
    const xs = new Set(layout.nodes.map((n) => n.x));
    expect(xs.size).toBe(1);
    const ys = layout.nodes.map((n) => n.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(NODE_H);
  });

  test('where nothing else decides where a node goes, the order it arrived in does', () => {
    const down = (keys: string[]) =>
      layoutGraph(keys.map((key) => node(key)), [])
        .nodes.sort((a, b) => a.y - b.y)
        .map((n) => n.key);
    // the read answers in key order, so that is what an untangled project reads as, top to bottom
    expect(down(['GF-1', 'GF-2', 'GF-3'])).toEqual(['GF-1', 'GF-2', 'GF-3']);
    // and it really is the input, not the key: hand them over shuffled and the drawing is shuffled
    expect(down(['GF-3', 'GF-1', 'GF-2'])).toEqual(['GF-3', 'GF-1', 'GF-2']);
  });

  test('an edge naming a node that is not drawn is dropped rather than throwing', () => {
    const layout = layoutGraph([node('GF-1')], [edge('GF-1', 'GF-9')]);
    expect(layout.nodes.map((n) => n.key)).toEqual(['GF-1']);
    expect(layout.edges).toEqual([]);
  });
});

describe('clipTitle', () => {
  test('a long title is cut with an ellipsis; a short one is left alone', () => {
    expect(clipTitle('short enough')).toBe('short enough');
    const long = 'a title that goes on well past the diamond it belongs to';
    expect(clipTitle(long).length).toBeLessThanOrEqual(26);
    expect(clipTitle(long).endsWith('…')).toBe(true);
    expect(long.startsWith(clipTitle(long).slice(0, -1))).toBe(true);
  });
});
