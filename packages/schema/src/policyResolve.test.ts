import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_PRESETS } from './policy.ts';
import { resolvePolicy } from './policyResolve.ts';

test('with no overrides, resolving standard returns the standard preset untouched', () => {
  const { policy, presetName, provenance } = resolvePolicy({}, {});
  assert.deepEqual(policy, POLICY_PRESETS.standard);
  assert.equal(presetName, 'standard');
  assert.equal(provenance['budgets.gateRetries']!.layer, 'preset');
});

test('a project override wins a leaf the file is silent on; the file wins a leaf both name', () => {
  const project = { budgets: { gateRetries: 5 } };
  const file = { budgets: { stallTimeoutMin: 99 } };
  const { policy } = resolvePolicy(project, file);
  assert.equal(policy.budgets.gateRetries, 5); // from project, file silent
  assert.equal(policy.budgets.stallTimeoutMin, 99); // from file, project silent
  assert.equal(policy.budgets.perTicketUsd, POLICY_PRESETS.standard.budgets.perTicketUsd); // from preset, both silent
});

test('a leaf both project and file name resolves to the file — the later layer wins', () => {
  const project = { budgets: { gateRetries: 5 } };
  const file = { budgets: { gateRetries: 9 } };
  const { policy } = resolvePolicy(project, file);
  assert.equal(policy.budgets.gateRetries, 9);
});

test('an unnamed leaf inherits from the layer below rather than being cleared', () => {
  const { policy } = resolvePolicy({ gates: { autoMerge: false } }, {});
  assert.equal(policy.gates.autoMerge, false);
  assert.equal(policy.gates.deploy, POLICY_PRESETS.standard.gates.deploy);
});

test('a layer naming an array replaces it wholesale rather than unioning with the layer below', () => {
  const project = { review: { lenses: ['correctness'] } };
  const file = { review: { lenses: ['correctness', 'security', 'ux'] } };
  const { policy } = resolvePolicy(project, file);
  assert.deepEqual(policy.review.lenses, ['correctness', 'security', 'ux']);
});

test('an explicitly empty array clears a list rather than being treated as absent', () => {
  const { policy } = resolvePolicy({}, { tools: { protectedPaths: [] } });
  assert.deepEqual(policy.tools.protectedPaths, []);
});

test('a file naming a different preset re-bases the merge, and the project deltas still apply on top', () => {
  // The project was configured against `standard` and overrode one leaf of it.
  const project = { preset: 'standard' as const, budgets: { gateRetries: 1 } };
  const file = { preset: 'vibe' as const };
  const { policy, presetName } = resolvePolicy(project, file);
  assert.equal(presetName, 'vibe');
  // vibe's own base value...
  assert.equal(policy.review.maxFixLoops, POLICY_PRESETS.vibe.review.maxFixLoops);
  // ...but the project's stale delta, computed against standard, still applies.
  assert.equal(policy.budgets.gateRetries, 1);
});

test('provenance names the layer that won each leaf', () => {
  const { provenance } = resolvePolicy({ budgets: { gateRetries: 5 } }, { budgets: { stallTimeoutMin: 9 } });
  assert.equal(provenance['budgets.gateRetries']!.layer, 'project');
  assert.equal(provenance['budgets.stallTimeoutMin']!.layer, 'file');
  assert.equal(provenance['budgets.perTicketUsd']!.layer, 'preset');
});

test('provenance records what a replaced array displaced, including the preset default', () => {
  const project = { review: { lenses: ['correctness'] } };
  const file = { review: { lenses: ['correctness', 'ux'] } };
  const { provenance } = resolvePolicy(project, file);
  const entry = provenance['review.lenses']!;
  assert.equal(entry.layer, 'file');
  assert.deepEqual(entry.value, ['correctness', 'ux']);
  assert.deepEqual(entry.displaced, [
    { layer: 'preset', value: POLICY_PRESETS.standard.review.lenses },
    { layer: 'project', value: ['correctness'] },
  ]);
});

test('a leaf named by only the preset shows no displaced values', () => {
  const { provenance } = resolvePolicy({}, {});
  assert.deepEqual(provenance['budgets.perTicketUsd']!.displaced, []);
});

test('a full policy given as the project override resolves to itself', () => {
  const { policy } = resolvePolicy(POLICY_PRESETS.serious, {});
  assert.deepEqual(policy, POLICY_PRESETS.serious);
});

test('a nested model-tier leaf merges independently of its siblings', () => {
  const project = { models: { builder: { budgetUsd: 999 } } };
  const { policy } = resolvePolicy(project, {});
  assert.equal(policy.models.builder!.budgetUsd, 999);
  assert.equal(policy.models.builder!.model, POLICY_PRESETS.standard.models.builder!.model);
  assert.deepEqual(policy.models.planner, POLICY_PRESETS.standard.models.planner);
});
