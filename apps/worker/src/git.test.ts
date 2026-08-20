import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, shortRevision } from './git.ts';

test('shortRevision() resolves the short sha of HEAD in a git checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'goblin-git-test-'));
  try {
    await git(dir, 'init', '-q');
    await git(dir, 'config', 'user.email', 'test@example.com');
    await git(dir, 'config', 'user.name', 'Test');
    await git(dir, 'commit', '--allow-empty', '-q', '-m', 'initial');
    const revision = await shortRevision(dir);
    const head = await git(dir, 'rev-parse', '--short', 'HEAD');
    assert.equal(revision, head.stdout.trim());
    assert.match(revision, /^[0-9a-f]{4,40}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('shortRevision() resolves to "unknown" outside a git checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'goblin-git-test-'));
  try {
    const revision = await shortRevision(dir);
    assert.equal(revision, 'unknown');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
