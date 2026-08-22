import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, ticketInColumn } from './boardColumns.ts';

const statuses = [
  { id: 'fac_b', kind: 'backlog' as const, name: 'Backlog', color: '#5B6578', enabled: true },
  { id: 'fac_d', kind: 'done' as const, name: 'Done', color: '#1E8E5A', enabled: true },
  { id: 'sub_b', kind: 'backlog' as const, name: 'Backlog', color: '#5B6578', enabled: true },
  { id: 'sub_can', kind: 'canceled' as const, name: 'Canceled', color: '#C8323C', enabled: true },
  { id: 'sub_hidden', kind: 'deploying' as const, name: 'Deploying', color: '#6146D6', enabled: false },
];

test('boardColumns() produces one column per enabled kind, in canonical order', () => {
  const cols = boardColumns(statuses);
  assert.deepEqual(cols.map(c => c.kind), ['backlog', 'done', 'canceled']);
});

test('boardColumns() carries the display name and colour from a row of that kind', () => {
  const cols = boardColumns(statuses);
  const done = cols.find(c => c.kind === 'done')!;
  assert.equal(done.name, 'Done');
  assert.equal(done.color, '#1E8E5A');
});

test('boardColumns() collects every status id for a kind', () => {
  const cols = boardColumns(statuses);
  const backlog = cols.find(c => c.kind === 'backlog')!;
  assert.deepEqual(backlog.statusIds, ['fac_b', 'sub_b']);
});

test('boardColumns() drops disabled kinds', () => {
  const cols = boardColumns(statuses);
  assert.equal(cols.some(c => c.kind === 'deploying'), false);
});

test('ticketInColumn() matches a ticket against the column status ids', () => {
  const cols = boardColumns(statuses);
  const backlog = cols.find(c => c.kind === 'backlog')!;
  assert.equal(ticketInColumn({ statusId: 'sub_b' }, backlog), true);
  assert.equal(ticketInColumn({ statusId: 'fac_d' }, backlog), false);
});
