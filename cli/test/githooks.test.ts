import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOKS = resolve(import.meta.dir, '../../.githooks');

describe('the lockfile hooks', () => {
  let root: string;
  let repo: string;
  let installs: string;
  const fakeBun = (exit: number) => {
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'bun'), `#!/bin/sh\npwd >> "${installs}"\nexit ${exit}\n`);
    chmodSync(join(bin, 'bun'), 0o755);
    return `${bin}:/usr/bin:/bin`;
  };
  const NO_BUN = '/usr/bin:/bin';

  const git = (args: string[], PATH = NO_BUN, cwd = repo) => {
    const run = Bun.spawnSync(['/usr/bin/git', ...args], {
      cwd,
      env: {
        PATH,
        HOME: root,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
    return { exit: run.exitCode, stderr: run.stderr.toString() };
  };
  const installedIn = () => (existsSync(installs) ? readFileSync(installs, 'utf8').trim().split('\n') : []);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gf-hooks-'));
    repo = join(root, 'repo');
    installs = join(root, 'installs');
    mkdirSync(repo);
    git(['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'bun.lock'), 'one\n');
    git(['add', '.']);
    git(['commit', '-qm', 'first']);
    git(['config', 'core.hooksPath', HOOKS]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a fresh worktree with no bun on PATH is made, and says to install', () => {
    const made = git(['worktree', 'add', '-q', '-b', 'fresh', join(root, 'fresh')]);
    expect(made.stderr).not.toContain('bad object');
    expect(made.stderr).toContain('run `bun install`');
    expect(made.exit).toBe(0);
    expect(existsSync(join(root, 'fresh', 'bun.lock'))).toBe(true);
  });

  test('a fresh worktree with bun on PATH installs once, in the worktree', () => {
    const made = git(['worktree', 'add', '-q', '-b', 'fresh', join(root, 'fresh')], fakeBun(0));
    expect(made.stderr).not.toContain('bad object');
    expect(made.exit).toBe(0);
    expect(installedIn()).toHaveLength(1);
    expect(installedIn()[0]).toEndWith('/fresh');
  });

  test('a failed install does not fail the checkout, and says so', () => {
    const made = git(['worktree', 'add', '-q', '-b', 'fresh', join(root, 'fresh')], fakeBun(1));
    expect(made.stderr).toContain('run `bun install`');
    expect(made.exit).toBe(0);
  });

  test('a branch switch installs only when bun.lock changed', () => {
    const path = fakeBun(0);
    git(['checkout', '-qb', 'same'], path);
    writeFileSync(join(repo, 'other'), 'x\n');
    git(['add', '.'], path);
    git(['commit', '-qm', 'not the lock'], path);
    expect(git(['checkout', '-q', 'main'], path).exit).toBe(0);
    expect(installedIn()).toEqual([]);

    git(['checkout', '-qb', 'moved'], path);
    writeFileSync(join(repo, 'bun.lock'), 'two\n');
    git(['add', '.'], path);
    git(['commit', '-qm', 'the lock'], path);
    expect(git(['checkout', '-q', 'main'], path).exit).toBe(0);
    expect(installedIn()).toHaveLength(1);
  });
});
