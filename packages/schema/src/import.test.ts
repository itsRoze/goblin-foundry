import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, mapSourceTickets, readyRefs, translateEdges, rewriteBodyReferences, type ImportReport } from './import.ts';

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

test('readyRefs() lists tickets that are not blocked by any edge', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  const entries = [...map.values()];
  const { edges } = translateEdges([{ blockerId: 40, blockedId: 24 }], map);
  const refs = readyRefs(entries, edges);
  assert.deepEqual(refs, ['SUB-1', 'SUB-3']);
});

test('readyRefs() returns every ticket when there are no edges', () => {
  const map = mapSourceTickets(tickets, 'SUB');
  const entries = [...map.values()];
  assert.deepEqual(readyRefs(entries, []), ['SUB-1', 'SUB-2', 'SUB-3']);
});

function makeReport(partial: Partial<ImportReport>): ImportReport {
  const base: ImportReport = {
    verdict: 'written',
    projectSlug: 'subway-reader',
    projectKey: 'SUB',
    projectName: 'Subway Reader',
    designSize: 42,
    designOpeningLine: 'First line.',
    sourceTicketCount: 3,
    importedTicketCount: 3,
    sourceDepCount: 2,
    importedDepCount: 1,
    skippedDepCount: 1,
    skippedCategories: [{ category: 'dependencies', count: 1, reason: 'endpoint missing' }],
    tickets: [
      { sourceId: 40, shortId: 1, ref: 'SUB-1', title: 'Scaffold' },
      { sourceId: 24, shortId: 2, ref: 'SUB-2', title: 'Feed engine' },
      { sourceId: 25, shortId: 3, ref: 'SUB-3', title: 'Prefetch' },
    ],
    edges: [{ blocker: { sourceId: 40, shortId: 1, ref: 'SUB-1', title: 'Scaffold' }, blocked: { sourceId: 24, shortId: 2, ref: 'SUB-2', title: 'Feed engine' } }],
    rewrittenRefs: 0,
    readyTickets: ['SUB-1', 'SUB-3'],
  };
  return { ...base, ...partial };
}

test('formatReport() starts with the verdict line', () => {
  const r = makeReport({ verdict: 'dry-run' });
  const out = formatReport(r);
  assert.match(out, /^VERDICT: dry run/);
});

test('formatReport() prints the identifier map', () => {
  const out = formatReport(makeReport({}));
  assert.match(out, /Identifier map:/);
  assert.match(out, /SUB-1  ←  smriti #40  Scaffold/);
});

test('formatReport() prints edges as ref pairs', () => {
  const out = formatReport(makeReport({}));
  assert.match(out, /Dependency edges:/);
  assert.match(out, /SUB-1 → SUB-2/);
});

test('formatReport() shows imported counts beside source counts', () => {
  const out = formatReport(makeReport({ importedTicketCount: 2, sourceDepCount: 5, importedDepCount: 3, skippedDepCount: 2 }));
  assert.match(out, /tickets: 2\/3/);
  assert.match(out, /dependencies: 3\/5 \(skipped 2\)/);
});

test('formatReport() prints skipped categories with count and reason', () => {
  const out = formatReport(makeReport({ skippedCategories: [{ category: 'dependencies', count: 1, reason: 'endpoint missing' }] }));
  assert.match(out, /Skipped:/);
  assert.match(out, /dependencies: 1 — endpoint missing/);
});

test('formatReport() prints design size and opening line', () => {
  const out = formatReport(makeReport({ designSize: 100, designOpeningLine: 'Open here.' }));
  assert.match(out, /project design: 100 chars, opening line: Open here\./);
});

test('formatReport() lists ready tickets', () => {
  const out = formatReport(makeReport({ readyTickets: ['SUB-1', 'SUB-3'] }));
  assert.match(out, /Ready to start \(no unfinished blocker\): SUB-1, SUB-3/);
});

test('formatReport() prints skipped edge details', () => {
  const out = formatReport(makeReport({ skippedDepCount: 1, skippedEdges: [{ sourceBlocker: 99, sourceBlocked: 40, reason: 'blocker 99 not imported' }] }));
  assert.match(out, /Skipped edges:/);
  assert.match(out, /99 → 40: blocker 99 not imported/);
});
