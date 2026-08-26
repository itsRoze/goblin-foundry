import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicyFile } from './policyParse.ts';

test('malformed YAML fails with the parser\'s own message and position', () => {
  const result = parsePolicyFile('gates:\n  design_approval: [required\n');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /line \d+, column \d+/);
});

test('a misspelled key inside an implemented section fails, naming the snake_case spelling written', () => {
  const result = parsePolicyFile('review:\n  max_fix_loop: 3\n');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.key, 'review.max_fix_loop');
  assert.match(result.errors[0]!.message, /review\.max_fix_loop/);
  assert.match(result.errors[0]!.message, /max_fix_loops/); // nearest valid sibling, also snake_case
});

test('several errors in one file are all reported together, not just the first', () => {
  const result = parsePolicyFile('review:\n  max_fix_loop: 3\nbudgets:\n  gate_retries: "two"\n');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors.length, 2);
  const keys = result.errors.map(e => e.key).sort();
  assert.deepEqual(keys, ['budgets.gate_retries', 'review.max_fix_loop']);
});

test('an unrecognised top-level section warns and resolution continues', () => {
  const result = parsePolicyFile('preset: standard\nqa:\n  web: playwright\n');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]!.key, 'qa');
  assert.equal(result.override.preset, 'standard');
});

test('the retired builder Bash key warns by name and is not reported as an unknown key', () => {
  const result = parsePolicyFile('tools:\n  builder_bash: ["pnpm test*"]\n  protected_paths: [".github/**"]\n');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]!.key, 'tools.builder_bash');
  assert.match(result.warnings[0]!.message, /removed/);
  assert.deepEqual(result.override.tools, { protectedPaths: ['.github/**'] });
});

test('an unknown model tier fails, naming the tier, rather than falling back at phase time', () => {
  const result = parsePolicyFile('models:\n  buildr:\n    model: x\n');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /models\.buildr/);
  assert.match(result.errors[0]!.message, /unknown phase/);
});

test('a wrong-typed value fails', () => {
  const result = parsePolicyFile('budgets:\n  gate_retries: "two"\n');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors[0]!.key, 'budgets.gate_retries');
});

test('one fatal error and one warning are both reported from the same file', () => {
  const result = parsePolicyFile('qa:\n  web: playwright\nbudgets:\n  gate_retries: "two"\n');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.errors.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]!.key, 'qa');
});

test('snake_case keys in the file map onto the camelCase policy override', () => {
  const result = parsePolicyFile('gates:\n  design_approval: required\n  auto_merge: true\nbudgets:\n  stall_timeout_min: 45\n');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  assert.deepEqual(result.override.gates, { designApproval: 'required', autoMerge: true });
  assert.deepEqual(result.override.budgets, { stallTimeoutMin: 45 });
});

const BLUEPRINT_REFERENCE_FILE = `
# factory.policy.yaml — lives in the target repo; the factory reads it on every run
preset: standard                 # serious | standard | vibe
gates:
  design_approval: required      # required | auto_after: 12h | skip
  pr_approval: skip              # required | skip
  auto_merge: true               # when review passes and CI is green
  deploy: auto                   # auto | manual
review:
  lenses: [correctness, security, tests, maintainability]
  max_fix_loops: 3
  block_on: important
models:
  planner:   {model: opus,   effort: high,  budget_usd: 6}
  builder:   {model: sonnet, effort: xhigh, budget_usd: 12, max_turns: 80}
  reviewer:  {model: opus,   effort: high,  budget_usd: 8}
  librarian: {model: haiku,  effort: low,   budget_usd: 1}
design:
  mockups: html                  # html | figma (only if the design system lives in Figma)
  storage: factory-db            # designs are stored, not committed (smriti's rule)
tools:
  builder_bash: ["pnpm test*", "pnpm typecheck", "pnpm lint", "pnpm build", "git *", "gh pr *", "xcrun simctl *", "xcodebuild test *"]
  protected_paths: [".github/**", "factory.policy.yaml", "docs/adr/**"]
qa:
  web: playwright                # playwright | chrome-devtools | none
  android: emulator               # emulator (gradle managed devices / adb + maestro) | none
  ios: none                      # simulator (xcrun simctl + xcodebuild test) — for the KMP phase
  database: template             # template (clone fixtures DB per run) | supabase-branch | none
access:                          # who may touch what
  builder:   [test_db_rw, browser, simulator]
  reviewer:  [test_db_ro, browser]
  planner:   []
  deployer:  [prod_deploy]
  conductor: [tickets_rw, project_design_rw]   # applies unattended only on vibe
commands:
  test: pnpm test
  typecheck: pnpm typecheck
  build: pnpm build
  deploy: vercel --prod
  verify: curl -fsS https://app.example.com/health
budgets:
  per_ticket_usd: 40
  stall_timeout_min: 30
  max_concurrent_runs: 2
notify: [push]
`;

test('the blueprint\'s published reference file resolves successfully, warning on its unimplemented sections and its retired key', () => {
  const result = parsePolicyFile(BLUEPRINT_REFERENCE_FILE);
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.errors));
  if (!result.ok) throw new Error('unreachable');
  const warningKeys = result.warnings.map(w => w.key).sort();
  assert.deepEqual(warningKeys, ['access', 'notify', 'qa', 'tools.builder_bash']);
  assert.equal(result.override.preset, 'standard');
  assert.equal(result.override.models?.builder?.effort, 'xhigh');
  assert.equal(result.override.tools?.protectedPaths?.length, 3);
  assert.equal((result.override.tools as { builderBash?: unknown })?.builderBash, undefined);
});
