import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkTool } from './guard.ts';

const WORKTREE = '/tmp/wt';

test('a write outside the worktree is a breach, inside it is not', () => {
  assert.equal(checkTool('Write', { file_path: 'src/a.ts' }, WORKTREE, []), null);
  assert.match(checkTool('Write', { file_path: '/etc/hosts' }, WORKTREE, [])!.reason, /outside the worktree/);
});

test('a protected path is readable but not writable', () => {
  assert.equal(checkTool('Read', { file_path: '.github/ci.yml' }, WORKTREE, ['.github/**']), null);
  assert.match(checkTool('Edit', { file_path: '.github/ci.yml' }, WORKTREE, ['.github/**'])!.reason, /protected path/);
});

test('git redirection out of the worktree is a breach', () => {
  assert.match(checkTool('Bash', { command: 'git -C /elsewhere status' }, WORKTREE, [])!.reason, /git redirection/);
});

test('a command reaching a real path outside the worktree is a breach', () => {
  assert.match(checkTool('Bash', { command: 'cat /Users/roze/.env' }, WORKTREE, [])!.reason, /outside the worktree/);
});

test('/** in a comment or a glob is not a path escape', () => {
  // A reviewer writing JSDoc in a `node -e` script was denied for this.
  assert.equal(checkTool('Bash', { command: 'node -e "/** doc */ console.log(1)"' }, WORKTREE, []), null);
  assert.equal(checkTool('Bash', { command: 'echo /**' }, WORKTREE, []), null);
});

test('the usual read-only system paths stay allowed', () => {
  assert.equal(checkTool('Bash', { command: '/usr/bin/env node --test' }, WORKTREE, []), null);
  assert.equal(checkTool('Bash', { command: 'cat /dev/null' }, WORKTREE, []), null);
});
