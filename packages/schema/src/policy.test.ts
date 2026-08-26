import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_PRESETS, PHASE_NAMES, policy, policyOverride } from './policy.ts';

for (const name of ['serious', 'standard', 'vibe'] as const) {
  test(`the ${name} preset validates against the policy type`, () => {
    const result = policy.safeParse(POLICY_PRESETS[name]);
    assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  });

  test(`the ${name} preset carries every known phase and no builder Bash value`, () => {
    const preset = POLICY_PRESETS[name];
    assert.deepEqual(Object.keys(preset.models).sort(), [...PHASE_NAMES].sort());
    assert.equal('builderBash' in preset.tools, false);
  });
}

test('serious names all six blueprint lenses', () => {
  assert.deepEqual(
    [...POLICY_PRESETS.serious.review.lenses].sort(),
    ['correctness', 'maintainability', 'performance', 'security', 'tests', 'ux'].sort(),
  );
});

test('vibe auto-approves design and runs two lenses over two fix loops', () => {
  assert.deepEqual(POLICY_PRESETS.vibe.gates.designApproval, { autoAfter: '1h' });
  assert.deepEqual(POLICY_PRESETS.vibe.review.lenses, ['correctness', 'tests']);
  assert.equal(POLICY_PRESETS.vibe.review.maxFixLoops, 2);
});

test('serious requires design and PR approval with manual deploy; standard and vibe do not', () => {
  assert.equal(POLICY_PRESETS.serious.gates.designApproval, 'required');
  assert.equal(POLICY_PRESETS.serious.gates.prApproval, 'required');
  assert.equal(POLICY_PRESETS.serious.gates.autoMerge, false);
  assert.equal(POLICY_PRESETS.serious.gates.deploy, 'manual');
  assert.equal(POLICY_PRESETS.standard.gates.prApproval, 'skip');
  assert.equal(POLICY_PRESETS.vibe.gates.prApproval, 'skip');
});

test('presets differ in gate retries and stall timeout: serious > standard > vibe', () => {
  assert.ok(POLICY_PRESETS.serious.budgets.gateRetries > POLICY_PRESETS.standard.budgets.gateRetries);
  assert.ok(POLICY_PRESETS.vibe.budgets.gateRetries < POLICY_PRESETS.standard.budgets.gateRetries);
  assert.ok(POLICY_PRESETS.serious.budgets.stallTimeoutMin > POLICY_PRESETS.standard.budgets.stallTimeoutMin);
  assert.ok(POLICY_PRESETS.vibe.budgets.stallTimeoutMin < POLICY_PRESETS.standard.budgets.stallTimeoutMin);
});

test('presets differ in per-ticket budget and in the builder model tier', () => {
  assert.ok(POLICY_PRESETS.serious.budgets.perTicketUsd > POLICY_PRESETS.standard.budgets.perTicketUsd);
  assert.ok(POLICY_PRESETS.vibe.budgets.perTicketUsd < POLICY_PRESETS.standard.budgets.perTicketUsd);
  assert.notDeepEqual(POLICY_PRESETS.serious.models.builder, POLICY_PRESETS.standard.models.builder);
  assert.notDeepEqual(POLICY_PRESETS.vibe.models.builder, POLICY_PRESETS.standard.models.builder);
});

test('presets do not share a mutable array reference for a leaf they happen to agree on', () => {
  assert.notEqual(POLICY_PRESETS.serious.tools.protectedPaths, POLICY_PRESETS.standard.tools.protectedPaths);
  assert.notEqual(POLICY_PRESETS.vibe.tools.protectedPaths, POLICY_PRESETS.standard.tools.protectedPaths);
});

test('a full policy is itself a valid override — nothing breaks during the sparse-column transition', () => {
  const result = policyOverride.safeParse(POLICY_PRESETS.standard);
  assert.equal(result.success, true);
});
