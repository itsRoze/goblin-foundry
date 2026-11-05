import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const AUTHOR = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

describe("an App's branches, read from its Checkout", () => {
  let h: Harness;
  let scratch: string;
  let repo: string;
  let worktrees: string;

  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...AUTHOR } });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
    return run.stdout.toString().trim();
  };
  const commit = (cwd: string, name: string) => {
    writeFileSync(join(cwd, name), name);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-qm', name);
  };
  const appWith = async (fields: Record<string, unknown>) => {
    const res = await req('/api/apps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `app-${Math.random()}`, ...fields }) });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number };
  };
  const branchesOf = (id: number) => req(`/api/apps/${id}/branches`);

  beforeEach(async () => {
    h = await makeTestApp();
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gf-branches-')));
    repo = join(scratch, 'subway-reader');
    worktrees = join(scratch, 'worktrees');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    commit(repo, 'first');
    await req('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worktree_root: worktrees }) });
  });
  afterEach(() => {
    h.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  test('says which branches there are, which is the default, where a new Worktree goes, and which are checked out where', async () => {
    git(repo, 'branch', 'feature/two');
    const linked = join(scratch, 'elsewhere');
    git(repo, 'worktree', 'add', '-q', '-b', 'in-a-worktree', linked);
    const app = await appWith({ checkout: repo });

    const res = await branchesOf(app.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      default: 'main',
      worktrees_in: join(worktrees, 'subway-reader'),
      branches: [
        { name: 'feature/two', kind: 'local', local: 'feature/two', checked_out: null },
        { name: 'in-a-worktree', kind: 'local', local: 'in-a-worktree', checked_out: { folder: linked, linked: true } },
        { name: 'main', kind: 'local', local: 'main', checked_out: { folder: repo, linked: false } },
      ],
      has_commit: true,
    });
  });

  test('lists remote-tracking branches after the local ones, origin first, without the remote HEAD', async () => {
    const upstream = join(scratch, 'upstream');
    git(scratch, 'clone', '-q', repo, upstream);
    git(repo, 'branch', 'only-on-the-remote');
    const fork = join(scratch, 'fork');
    git(scratch, 'clone', '-q', repo, fork);
    git(fork, 'remote', 'add', 'another', upstream);
    git(fork, 'fetch', '-q', 'another');
    const app = await appWith({ checkout: fork });

    const body = (await (await branchesOf(app.id)).json()) as { default: string; branches: { name: string; kind: string; local: string }[] };
    expect(body.default).toBe('main');
    expect(body.branches.map(({ name, kind, local }) => ({ name, kind, local }))).toEqual([
      { name: 'main', kind: 'local', local: 'main' },
      { name: 'origin/main', kind: 'remote', local: 'main' },
      { name: 'origin/only-on-the-remote', kind: 'remote', local: 'only-on-the-remote' },
      { name: 'another/main', kind: 'remote', local: 'main' },
    ]);
  });

  test('a Worktree whose folder is gone is not somewhere the branch is checked out', async () => {
    const linked = join(scratch, 'elsewhere');
    git(repo, 'worktree', 'add', '-q', '-b', 'gone', linked);
    rmSync(linked, { recursive: true, force: true });
    const app = await appWith({ checkout: repo });
    const body = (await (await branchesOf(app.id)).json()) as { branches: { name: string; checked_out: unknown }[] };
    expect(body.branches.find((b) => b.name === 'gone')?.checked_out).toBeNull();
  });

  test('reads the Checkout live, and stores nothing', async () => {
    const app = await appWith({ checkout: repo });
    const history = async () => (await (await req(`/api/apps/${app.id}/events`)).json()) as unknown[];
    const before = await history();
    const names = async () => ((await (await branchesOf(app.id)).json()) as { branches: { name: string }[] }).branches.map((b) => b.name);
    expect(await names()).toEqual(['main']);
    git(repo, 'branch', 'made-since');
    expect(await names()).toEqual(['made-since', 'main']);
    expect(await history()).toEqual(before);
    expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
  });

  test('an App with no Checkout, or one that has gone, is refused with a sentence', async () => {
    const none = await appWith({ name: 'No Home' });
    const res = await branchesOf(none.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { hint: string }).hint).toBe('No Home has no Checkout, so it has no branches to read');

    const app = await appWith({ checkout: repo });
    rmSync(repo, { recursive: true, force: true });
    const gone = await branchesOf(app.id);
    expect(gone.status).toBe(409);
    expect(((await gone.json()) as { hint: string }).hint).toBe(`the Checkout ${repo} is not there`);
  });

  test('a repository with no commit yet still answers, and says there is nothing to cut a branch from', async () => {
    const empty = join(scratch, 'empty');
    mkdirSync(empty);
    git(empty, 'init', '-q', '-b', 'main');
    const app = await appWith({ checkout: empty });
    const res = await branchesOf(app.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ default: 'HEAD', worktrees_in: join(worktrees, 'empty'), branches: [], has_commit: false });
  });

  test('a commit with no branch on it is still something to cut from', async () => {
    git(repo, 'switch', '-q', '--detach');
    git(repo, 'branch', '-q', '-D', 'main');
    const app = await appWith({ checkout: repo });
    expect(await (await branchesOf(app.id)).json()).toEqual({ default: 'HEAD', worktrees_in: join(worktrees, 'subway-reader'), branches: [], has_commit: true });
  });

  test('an App nobody has is a 404', async () => {
    expect((await branchesOf(999)).status).toBe(404);
  });
});
