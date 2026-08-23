import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnblockingKind, ticketReadiness } from './readiness.ts';
import type { StatusKind } from './types.ts';

function blocker(kind: StatusKind) {
  return { status: { kind } };
}

test('isUnblockingKind() is true for done and canceled only', () => {
  assert.equal(isUnblockingKind('done'), true);
  assert.equal(isUnblockingKind('canceled'), true);
  assert.equal(isUnblockingKind('backlog'), false);
  assert.equal(isUnblockingKind('ready_for_dev'), false);
});

test('ticketReadiness(): no blockers is ready', () => {
  assert.deepEqual(ticketReadiness([]), { ready: true });
});

test('ticketReadiness(): every blocker done is ready', () => {
  assert.deepEqual(ticketReadiness([blocker('done'), blocker('done')]), { ready: true });
});

test('ticketReadiness(): every blocker canceled is ready', () => {
  assert.deepEqual(ticketReadiness([blocker('canceled')]), { ready: true });
});

test('ticketReadiness(): one unfinished blocker among finished ones is blocked', () => {
  const r = ticketReadiness([blocker('done'), blocker('backlog'), blocker('canceled')]);
  assert.equal(r.ready, false);
  assert.equal((r as { ready: false; unfinished: unknown[] }).unfinished.length, 1);
});
