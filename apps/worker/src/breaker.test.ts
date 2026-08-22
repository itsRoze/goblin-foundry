import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { backoffMs, checkRate, RUNAWAY_RUNS, wasInstant } from './breaker.ts';

test('the rate breaker trips on a rate real work cannot reach', () => {
  assert.equal(checkRate(RUNAWAY_RUNS - 1).tripped, false);
  const tripped = checkRate(RUNAWAY_RUNS);
  assert.equal(tripped.tripped, true);
  // The reason has to be readable in a log at 3am.
  assert.match((tripped as { reason: string }).reason, /runs in the last 10 minutes/);
});

test('backoff grows with each instant failure and stops at five minutes', () => {
  assert.equal(backoffMs(0), 0);
  assert.equal(backoffMs(1), 5_000);
  assert.equal(backoffMs(2), 20_000);
  assert.equal(backoffMs(3), 45_000);
  assert.equal(backoffMs(50), 5 * 60_000);
});

test('a run that took no time at all is an instant failure', () => {
  const start = new Date('2026-08-22T03:00:00Z');
  assert.equal(wasInstant(start, new Date('2026-08-22T03:00:01Z')), true);
  assert.equal(wasInstant(start, new Date('2026-08-22T03:02:00Z')), false);
});
