import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { asHalt, HaltError, haltReasonFor, overBudget } from './halt.ts';

test('the SDK budget and limit errors are named, not treated as crashes', () => {
  assert.equal(haltReasonFor(new Error('Claude Code returned an error result: Reached maximum budget ($6)')),
               'budget_exhausted');
  assert.equal(haltReasonFor(new Error("You've hit your session limit · resets 8:50pm")), 'usage_limit');
  assert.equal(haltReasonFor(new Error('ECONNRESET')), null);
});

test('asHalt passes a HaltError through and leaves other errors alone', () => {
  const halt = new HaltError('budget_exhausted', 'no money');
  assert.equal(asHalt(halt), halt);
  assert.equal(asHalt(new Error('worktree add failed')), null);
  assert.equal(asHalt(new Error('Reached maximum budget ($6)'))?.reason, 'budget_exhausted');
});

test('overBudget only stops when a cap exists and is reached', () => {
  assert.equal(overBudget(39.9, 40), false);
  assert.equal(overBudget(40, 40), true);
  assert.equal(overBudget(1000, 0), false);
});
