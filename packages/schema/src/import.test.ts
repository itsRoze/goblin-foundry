import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSourceTickets, translateEdges, rewriteBodyReferences } from './import.ts';

const tickets = [
  { id: 40, position: 0, title: 'Scaffold', body: '' },
  { id: 24, position: 1, title: 'Feed engine', body: '' },
  { id: 25, position: 2, title: 'Prefetch', body: '' },
];

test('mapSourceTickets() orders by position and numbers from 1', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  assert.equal(map.get(40)!.shortId, 1);
  assert.equal(map.get(24)!.shortId, 2);
  assert.equal(map.get(25)!.shortId, 3);
});

test('mapSourceTickets() breaks ties by source id', () => {
  const tied = [
    { id: 3, position: 0, title: 'Three', body: '' },
    { id: 1, position: 0, title: 'One', body: '' },
    { id: 2, position: 0, title: 'Two', body: '' },
  ];
  const map = mapSourceTickets(tied, 'SUB');
  assert.deepEqual([map.get(1)!.shortId, map.get(2)!.shortId, map.get(3)!.shortId], [1, 2, 3]);
});

test('mapSourceTickets() formats refs with the project key', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  assert.equal(map.get(40)!.ref, 'SUB-1');
});

test('translateEdges() produces the expected factory edge set', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  const { edges, skipped } = translateEdges([
    { blockerId: 40, blockedId: 24 },
    { blockerId: 24, blockedId: 25 },
  ], map);
  assert.equal(edges.length, 2);
  assert.equal(skipped.length, 0);
  assert.equal(edges[0]!.blocker.ref, 'SUB-1');
  assert.equal(edges[0]!.blocked.ref, 'SUB-2');
  assert.equal(edges[1]!.blocker.ref, 'SUB-2');
  assert.equal(edges[1]!.blocked.ref, 'SUB-3');
});

test('translateEdges() skips edges whose endpoint was not imported', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  const { edges, skipped } = translateEdges([{ blockerId: 99, blockedId: 24 }], map);
  assert.equal(edges.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]!.reason, 'blocker 99 not imported');
});

test('translateEdges() never swaps blocker and blocked', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  const { edges } = translateEdges([{ blockerId: 40, blockedId: 24 }], map);
  assert.equal(edges[0]!.blocker.sourceId, 40);
  assert.equal(edges[0]!.blocked.sourceId, 24);
});

test('rewriteBodyReferences() rewrites only hash-prefixed numbers in the map', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  const { body, rewritten } = rewriteBodyReferences('See #40 and #24. Also 40 and #99.', map);
  assert.equal(rewritten, 2);
  assert.equal(body, 'See SUB-1 and SUB-2. Also 40 and #99.');
});
