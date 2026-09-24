import { describe, expect, test } from 'bun:test';
import type { GraphEdge, GraphNode } from '@goblin/shared';
import { NODE_H, NODE_W, traceGraph, layoutGraph } from '../src/graph';

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
 * order (a blocker is always to the left of what it waits on), the endpoints of an
 * edge, and that the same graph lays out the same way
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

  test('routes connect side ports without passing through either ticket label', () => {
    const layout = layoutGraph([node('GF-1'), node('GF-2')], [edge('GF-1', 'GF-2')]);
    const from = at(layout, 'GF-1');
    const to = at(layout, 'GF-2');
    expect(layout.edges[0]!.path.startsWith(`M ${from.x + NODE_W} ${from.y + NODE_H / 2}`)).toBe(true);
    expect(layout.edges[0]!.path.endsWith(`${to.x} ${to.y + NODE_H / 2}`)).toBe(true);
    expect(layout.edges[0]!.path).not.toMatch(/NaN|Infinity/);
  });

  test('narrow layouts flow down and reserve the full width of long keys', () => {
    const layout = layoutGraph([node('GF-123456'), node('GF-2'), node('GF-3')], [edge('GF-123456', 'GF-2'), edge('GF-2', 'GF-3')], true);
    expect(at(layout, 'GF-123456').width).toBeGreaterThan(NODE_W);
    expect(at(layout, 'GF-123456').y + NODE_H).toBeLessThan(at(layout, 'GF-2').y);
    expect(at(layout, 'GF-2').y + NODE_H).toBeLessThan(at(layout, 'GF-3').y);
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
    }
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

describe('traceGraph', () => {
  test('traces complete chains and joins but excludes sibling branches', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('x', 'c'), edge('c', 'd'), edge('d', 'e'), edge('b', 'sibling')];
    const trace = traceGraph('c', edges);
    expect([...trace.upstream.nodes].sort()).toEqual(['a', 'b', 'x']);
    expect([...trace.downstream.nodes].sort()).toEqual(['d', 'e']);
    expect(trace.upstream.paths.has('b>sibling')).toBe(false);
    expect(trace.upstream.paths.size).toBe(3);
    expect(trace.downstream.paths.size).toBe(2);
  });
  test('clears without a selection and terminates safely on a cycle', () => {
    const edges = [edge('a', 'b'), edge('b', 'a')];
    expect(traceGraph(null, edges).upstream.nodes.size).toBe(0);
    expect([...traceGraph('a', edges).downstream.nodes]).toEqual(['b']);
  });
});
