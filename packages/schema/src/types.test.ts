import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report, violations, type GateCheck } from '@goblin/schema';

const ok = (item: string, note = ''): GateCheck => ({ item, ok: true, note });
const fail = (item: string, note = ''): GateCheck => ({ item, ok: false, note });

test('report() passes and preserves order when every check is ok', () => {
  const checks = [ok('a'), ok('b'), ok('c')];
  const r = report('my-gate', checks);
  assert.equal(r.gate, 'my-gate');
  assert.equal(r.passed, true);
  assert.deepEqual(r.checks, checks);
});

test('report() fails when at least one check is not ok', () => {
  const r = report('my-gate', [ok('a'), fail('b', 'exit 1'), ok('c')]);
  assert.equal(r.passed, false);
});

test('report() passes on an empty check list', () => {
  const r = report('my-gate', []);
  assert.equal(r.passed, true);
  assert.deepEqual(r.checks, []);
});

test('violations() returns one "item: note" string per failed check', () => {
  const r = report('my-gate', [ok('a'), fail('b', 'exit 1'), fail('c', 'not in the diff')]);
  assert.deepEqual(violations(r), ['b: exit 1', 'c: not in the diff']);
});

test('violations() returns nothing when every check passes', () => {
  const r = report('my-gate', [ok('a'), ok('b')]);
  assert.deepEqual(violations(r), []);
});

test('violations() falls back to "item: failed" when the note is empty', () => {
  const r = report('my-gate', [fail('b')]);
  assert.deepEqual(violations(r), ['b: failed']);
});
