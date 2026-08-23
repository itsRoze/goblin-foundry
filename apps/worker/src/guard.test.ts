import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkTool, looksLikePath } from './guard.ts';

const WORKTREE = '/tmp/wt';

test('a write outside the worktree is a breach, inside it is not', () => {
  assert.equal(checkTool('Write', { file_path: 'src/a.ts' }, WORKTREE, []), null);
  assert.match(checkTool('Write', { file_path: '/etc/hosts' }, WORKTREE, [])!.reason, /outside the worktree/);
});

test('a protected path is readable but not writable', () => {
  assert.equal(checkTool('Read', { file_path: '.github/ci.yml' }, WORKTREE, ['.github/**']), null);
  assert.match(checkTool('Edit', { file_path: '.github/ci.yml' }, WORKTREE, ['.github/**'])!.reason, /protected path/);
});

test('git -C is a breach only when it points somewhere else', () => {
  assert.match(checkTool('Bash', { command: 'git -C /elsewhere status' }, WORKTREE, [])!.reason,
               /points outside the worktree/);
  // Its own worktree, by absolute path, by relative path, and quoted.
  assert.equal(checkTool('Bash', { command: `git -C ${WORKTREE} log --oneline -3` }, WORKTREE, []), null);
  assert.equal(checkTool('Bash', { command: 'git -C . status' }, WORKTREE, []), null);
  assert.equal(checkTool('Bash', { command: `git -C "${WORKTREE}/apps" diff` }, WORKTREE, []), null);
});

test('redirection that names another repository is still a breach', () => {
  for (const command of ['git --git-dir=/other/.git log', 'GIT_WORK_TREE=/other git status']) {
    assert.match(checkTool('Bash', { command }, WORKTREE, [])!.reason, /git redirection/, command);
  }
});

test('a command reaching a real path outside the worktree is a breach', () => {
  assert.match(checkTool('Bash', { command: 'cat /Users/roze/.env' }, WORKTREE, [])!.reason, /outside the worktree/);
});

test('code that merely contains slashes is not a path escape', () => {
  // Two thirds of every denial recorded was one of these.
  const notPaths = [
    'node -e "/** doc */ console.log(1)"',
    "node -e \"s.replace(/\\p{M}/gu, '')\"",
    'echo /**',
    'grep -r "/posts/" .',
    'node -e "import(\'/src/slug.js\')"',
  ];
  for (const command of notPaths) {
    assert.equal(checkTool('Bash', { command }, WORKTREE, []), null, command);
  }
});

test('looksLikePath knows a root from a regex flag', () => {
  assert.equal(looksLikePath('/Users/roze/.env'), true);
  assert.equal(looksLikePath('/etc/hosts'), true);
  assert.equal(looksLikePath('/g'), false);
  assert.equal(looksLikePath('/gu,'), false);
  assert.equal(looksLikePath('//'), false);
  assert.equal(looksLikePath('/src/slug.js'), false);
});

test('the real escapes are still denied', () => {
  assert.match(checkTool('Bash', { command: 'cat /Users/roze/dev/factory/.env' }, WORKTREE, [])!.reason,
               /outside the worktree/);
  assert.match(checkTool('Read', { file_path: '/Users/roze/.ssh/id_rsa' }, WORKTREE, [])!.reason,
               /outside the worktree/);
});

test('scratch space is allowed to every tool, not just Bash', () => {
  assert.equal(checkTool('Write', { file_path: '/tmp/verify.mjs' }, WORKTREE, []), null);
  assert.equal(checkTool('Bash', { command: 'node /tmp/verify.mjs' }, WORKTREE, []), null);
});

test('the usual read-only system paths stay allowed', () => {
  assert.equal(checkTool('Bash', { command: '/usr/bin/env node --test' }, WORKTREE, []), null);
  assert.equal(checkTool('Bash', { command: 'cat /dev/null' }, WORKTREE, []), null);
});
