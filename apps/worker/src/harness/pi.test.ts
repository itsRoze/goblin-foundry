import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { guardExtension, parseModelRef, piTools } from './pi.ts';

const PHASE = {
  runId: 'run_1', phaseId: 'phs_1', agent: 'builder', cwd: '/tmp/wt',
  model: 'opencode-go/kimi-k3', effort: 'low' as const, maxTurns: 10, maxBudgetUsd: 1,
  allowedTools: ['Read', 'Bash'], protectedPaths: ['.github/**'], systemPrompt: '',
};

/** Collects the handler pi would register, so it can be called directly. */
function register(onBreach = (_t: string, _i: unknown, _r: string) => {}) {
  let handler: ((event: { toolName: string; input: unknown }) => unknown) | undefined;
  const pi = { on: (_event: string, fn: typeof handler) => { handler = fn; } };
  guardExtension(PHASE, onBreach).factory(pi as never);
  assert.ok(handler, 'the extension registered no tool_call handler');
  return handler!;
}

test('parseModelRef splits provider from model, and rejects what is not a ref', () => {
  assert.deepEqual(parseModelRef('opencode-go/kimi-k3'), { provider: 'opencode-go', model: 'kimi-k3' });
  assert.equal(parseModelRef('sonnet'), null);
  assert.equal(parseModelRef('/leading'), null);
  assert.equal(parseModelRef('trailing/'), null);
});

test('piTools maps the phase tool names onto pi built-ins and drops the rest', () => {
  assert.deepEqual(piTools(['Read', 'Bash', 'AskUserQuestion', 'Agent']), ['read', 'bash']);
  assert.deepEqual(piTools(['Read', 'Read']), ['read']);
});

test('the guard blocks a read outside the worktree, and reports it once', () => {
  const breaches: string[] = [];
  const handler = register((tool, _input, reason) => breaches.push(`${tool}: ${reason}`));
  const result = handler({ toolName: 'read', input: { path: '/Users/roze/dev/factory/.env' } }) as
    { block?: boolean; reason?: string };
  assert.equal(result?.block, true);
  assert.match(result!.reason!, /outside the worktree/);
  assert.equal(breaches.length, 1);
});

test('the guard blocks a bash command that reaches out of the worktree', () => {
  const handler = register();
  const result = handler({ toolName: 'bash', input: { command: 'cat /Users/roze/.ssh/id_rsa' } }) as
    { block?: boolean };
  assert.equal(result?.block, true);
});

test('the guard blocks a write to a protected path and allows an ordinary one', () => {
  const handler = register();
  assert.equal((handler({ toolName: 'write', input: { path: '.github/ci.yml' } }) as { block?: boolean })?.block, true);
  assert.equal(handler({ toolName: 'write', input: { path: 'src/app.ts' } }), undefined);
});

test('work inside the worktree is not blocked', () => {
  const handler = register();
  assert.equal(handler({ toolName: 'read', input: { path: 'package.json' } }), undefined);
  assert.equal(handler({ toolName: 'bash', input: { command: 'pnpm test' } }), undefined);
});
