import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

const AUTHOR = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

describe('Start makes the Ticket a Worktree, against real git', () => {
  let h: Harness;
  /** Real, because macOS's temp dir is reached through a symlink and git answers with where it actually is. */
  let scratch: string;
  let repo: string;
  let worktrees: string;

  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const read = async (key: string) => (await req(`/api/tickets/${key}`)).json();
  const start = (key: string, body: unknown = {}) => post(`/api/tickets/${key}/start`, body);

  const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...AUTHOR } });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
    return run.stdout.toString().trim();
  };
  const commit = (cwd: string, name: string) => {
    writeFileSync(join(cwd, name), name);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-qm', name);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  const branches = (cwd: string) => git(cwd, 'branch', '--format=%(refname:short)').split('\n').sort();
  const headOf = (cwd: string) => git(cwd, 'rev-parse', 'HEAD');
  const branchAt = (cwd: string) => git(cwd, 'symbolic-ref', '--short', 'HEAD');
  const folderOf = (slug: string) => join(worktrees, 'subway-reader', slug);

  /** A `ready` Ticket on an App whose Checkout is the test's repository, unless told otherwise. */
  const ready = async (app: Record<string, unknown> = {}, title = 'Parse the feed') => {
    const created = await (await post('/api/apps', { name: `app-${Math.random()}`, checkout: repo, ...app })).json();
    const t = await (await post('/api/tickets', { title, app_id: created.id, status: 'ready', simple: true })).json();
    return t.key as string;
  };

  beforeEach(async () => {
    h = await makeTestApp();
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gf-worktree-')));
    repo = join(scratch, 'subway-reader');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    commit(repo, 'first');
    worktrees = join(scratch, 'worktrees');
    expect((await req('/api/settings', json('PATCH', { worktree_root: worktrees }))).status).toBe(200);
  });
  afterEach(() => {
    h.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  test('with every default: a new branch named by the suggestion, cut from the Checkout, recorded with the move and one event', async () => {
    const key = await ready();
    const res = await start(key);
    expect(res.status).toBe(200);
    const branch = `${key.toLowerCase()}-parse-the-feed`;
    const folder = folderOf(branch);
    expect(await res.json()).toMatchObject({ key, status: 'building', worktree_branch: branch, worktree_folder: folder });

    expect(await read(key)).toMatchObject({ status: 'building', worktree_branch: branch, worktree_folder: folder });
    expect(branchAt(folder)).toBe(branch);
    expect(headOf(folder)).toBe(headOf(repo));

    const events = await (await req(`/api/tickets/${key}/events`)).json();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'transitioned',
      actor: 'human',
      prior: { status: 'ready', worktree_branch: null, worktree_folder: null },
      new: { status: 'building', transition: 'start', worktree_branch: branch, worktree_folder: folder },
    });
  });

  describe('a bare start stays the Transition it always was', () => {
    test.each([
      ['no body at all', { method: 'POST' }],
      ['a JSON content type and nothing in it', json('POST')],
    ])('%s: no folder, no fields, and the event it always wrote', async (_, init) => {
      const key = await ready();
      const res = await req(`/api/tickets/${key}/start`, init);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'building', worktree_branch: null, worktree_folder: null });
      expect(existsSync(worktrees)).toBe(false);
      const [event] = await (await req(`/api/tickets/${key}/events`)).json();
      expect([event.prior, event.new]).toEqual([{ status: 'ready' }, { status: 'building', transition: 'start' }]);
    });

    test('a bulk start of the same Ticket makes no Worktree either', async () => {
      const key = await ready();
      const res = await post('/api/tickets/bulk', { tickets: [key], action: { kind: 'transition', name: 'start' } });
      expect(res.status).toBe(200);
      expect(await read(key)).toMatchObject({ status: 'building', worktree_branch: null });
      expect(existsSync(worktrees)).toBe(false);
    });

    test('no other verb reads a body', async () => {
      const key = await ready();
      const res = await req(`/api/tickets/${key}/unapprove`, { method: 'POST', body: 'not json' });
      expect([res.status, (await res.json()).status]).toEqual([200, 'planning']);
    });
  });

  describe('what is refused, before any folder is made', () => {
    test('a Ticket that cannot be started', async () => {
      const key = await ready();
      expect((await post(`/api/tickets/${key}/unapprove`)).status).toBe(200);
      const res = await start(key);
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toBe('a ticket in planning does not go to building');
      expect(existsSync(worktrees)).toBe(false);
      expect(branches(repo)).toEqual(['main']);
    });

    test('a Ticket whose App has no Checkout, naming it, while a bare start on the same Ticket still goes through', async () => {
      const key = await ready({ name: 'Subway Reader', checkout: null });
      const res = await start(key);
      expect(res.status).toBe(409);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      expect((await res.json()).hint).toBe(`nothing changed — Subway Reader has no Checkout, so ${key} cannot be given a Worktree; record the folder that holds its repository on the App`);
      expect((await read(key)).status).toBe('ready');
      expect((await post(`/api/tickets/${key}/start`)).status).toBe(200);
    });

    test.each([
      ['an unknown field', { folder: '/tmp/x' }, ['folder']],
      ['a branch that is not text', { branch: 7 }, ['branch']],
      ['an empty branch', { branch: '  ' }, ['branch']],
      // never reaches git: a process cannot be handed one, and the failure would read as git being missing
      ['a NUL in a branch', { branch: 'nul\0byte' }, ['branch']],
      ['a NUL in a base', { base: 'nul\0byte' }, ['base']],
    ])('%s', async (_, body, path) => {
      const key = await ready();
      const res = await start(key, body);
      expect(res.status).toBe(422);
      expect((await res.json()).issues[0].path).toEqual(path);
      expect((await read(key)).status).toBe('ready');
      expect(existsSync(worktrees)).toBe(false);
    });

    test('a body that is not JSON', async () => {
      const key = await ready();
      const res = await req(`/api/tickets/${key}/start`, { method: 'POST', body: '{nope' });
      expect(res.status).toBe(422);
      expect((await read(key)).status).toBe('ready');
    });
  });

  describe('a new branch', () => {
    test('is cut from the base asked for', async () => {
      git(repo, 'switch', '-qc', 'other');
      const tip = commit(repo, 'on-other');
      git(repo, 'switch', '-q', 'main');
      const key = await ready();
      const res = await start(key, { branch: 'stacked', base: 'other' });
      expect(res.status).toBe(200);
      expect(headOf(folderOf('stacked'))).toBe(tip);
      expect(branchAt(folderOf('stacked'))).toBe('stacked');
    });

    test("is cut from the App's default branch when it names one, wherever the Checkout is", async () => {
      git(repo, 'switch', '-qc', 'develop');
      const tip = commit(repo, 'on-develop');
      git(repo, 'switch', '-qc', 'elsewhere');
      commit(repo, 'on-elsewhere');
      const key = await ready({ repository_url: 'https://example.com/r', default_branch: 'develop' });
      expect((await start(key, { branch: 'cut' })).status).toBe(200);
      expect(headOf(folderOf('cut'))).toBe(tip);
    });

    test("is cut from the Checkout's default branch when the App names none, not from wherever it happens to be", async () => {
      const tip = headOf(repo);
      git(repo, 'switch', '-qc', 'elsewhere');
      commit(repo, 'on-elsewhere');
      const key = await ready();
      expect((await start(key, { branch: 'cut' })).status).toBe(200);
      expect(headOf(folderOf('cut'))).toBe(tip);
    });

    test("takes the Checkout's default branch from what a clone recorded of its remote, with no local copy of it needed", async () => {
      git(repo, 'switch', '-qc', 'trunk');
      const tip = commit(repo, 'on-trunk');
      const cloned = join(scratch, 'clone', 'subway-reader');
      mkdirSync(join(scratch, 'clone'));
      git(join(scratch, 'clone'), 'clone', '-q', repo, cloned);
      git(cloned, 'switch', '-qc', 'elsewhere');
      commit(cloned, 'on-elsewhere');
      git(cloned, 'branch', '-qD', 'trunk');
      const key = await ready({ checkout: cloned });
      expect((await start(key, { branch: 'cut' })).status).toBe(200);
      expect(headOf(folderOf('cut'))).toBe(tip);
    });

    test('takes a base only a remote holds, and does not follow it, so a later push is not aimed at the base', async () => {
      git(repo, 'switch', '-qc', 'only-there');
      const tip = commit(repo, 'on-only-there');
      git(repo, 'switch', '-q', 'main');
      const cloned = join(scratch, 'clone', 'subway-reader');
      mkdirSync(join(scratch, 'clone'));
      git(join(scratch, 'clone'), 'clone', '-q', repo, cloned);
      const key = await ready({ checkout: cloned });
      expect((await start(key, { branch: 'cut', base: 'only-there' })).status).toBe(200);
      expect(headOf(folderOf('cut'))).toBe(tip);
      expect(Bun.spawnSync(['git', 'config', 'branch.cut.remote'], { cwd: cloned }).exitCode).toBe(1);
    });
  });

  describe('a branch that exists', () => {
    test('locally is checked out into a new worktree, and a base means nothing to it', async () => {
      git(repo, 'switch', '-qc', 'work');
      const tip = commit(repo, 'on-work');
      git(repo, 'switch', '-q', 'main');
      const key = await ready();
      expect((await start(key, { branch: 'work', base: 'main' })).status).toBe(200);
      expect(branchAt(folderOf('work'))).toBe('work');
      expect(headOf(folderOf('work'))).toBe(tip);
    });

    test('only on a remote is created locally tracking it, however it was named', async () => {
      git(repo, 'switch', '-qc', 'theirs');
      const tip = commit(repo, 'on-theirs');
      git(repo, 'switch', '-qc', 'theirs-too');
      git(repo, 'switch', '-q', 'main');
      const cloned = join(scratch, 'clone', 'subway-reader');
      mkdirSync(join(scratch, 'clone'));
      git(join(scratch, 'clone'), 'clone', '-q', repo, cloned);
      expect(branches(cloned)).toEqual(['main']);

      const first = await ready({ checkout: cloned });
      expect((await start(first, { branch: 'theirs' })).status).toBe(200);
      expect(headOf(folderOf('theirs'))).toBe(tip);
      expect(git(cloned, 'rev-parse', '--abbrev-ref', 'theirs@{upstream}')).toBe('origin/theirs');

      const second = await ready({ checkout: cloned });
      expect(await (await start(second, { branch: 'origin/theirs-too' })).json()).toMatchObject({ worktree_branch: 'theirs-too', worktree_folder: folderOf('theirs-too') });
      expect(git(cloned, 'rev-parse', '--abbrev-ref', 'theirs-too@{upstream}')).toBe('origin/theirs-too');
    });

    test('already in a linked worktree is adopted, wherever that folder is', async () => {
      const there = join(scratch, 'somewhere-else');
      git(repo, 'worktree', 'add', '-q', '-b', 'begun', there);
      const key = await ready();
      expect(await (await start(key, { branch: 'begun' })).json()).toMatchObject({ status: 'building', worktree_branch: 'begun', worktree_folder: there });
      expect(existsSync(worktrees)).toBe(false);
    });

    test('in the Checkout itself is not adopted: that is not a Worktree, and git says where it is', async () => {
      const key = await ready();
      const res = await start(key, { branch: 'main' });
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toContain(`'main' is already used by worktree at '${repo}'`);
      expect(await read(key)).toMatchObject({ status: 'ready', worktree_branch: null, worktree_folder: null });
    });
  });

  describe('the folder', () => {
    test('is <root>/<repository folder name>/<branch slug>', async () => {
      const key = await ready();
      expect(await (await start(key, { branch: 'feature/x@y' })).json()).toMatchObject({ worktree_branch: 'feature/x@y', worktree_folder: join(worktrees, 'subway-reader', 'feature-x-y') });
      expect(branchAt(folderOf('feature-x-y'))).toBe('feature/x@y');
    });

    test('under a root written with `~` lands in the home folder it means', async () => {
      expect((await req('/api/settings', json('PATCH', { worktree_root: `~/${relative(homedir(), worktrees)}` }))).status).toBe(200);
      const key = await ready();
      expect(await (await start(key, { branch: 'homed' })).json()).toMatchObject({ worktree_folder: folderOf('homed') });
    });

    test('through a symlinked root is the same string on the first Start and the repeat', async () => {
      const real = join(scratch, 'real-root');
      mkdirSync(real);
      Bun.spawnSync(['ln', '-s', real, join(scratch, 'linked-root')]);
      expect((await req('/api/settings', json('PATCH', { worktree_root: join(scratch, 'linked-root') }))).status).toBe(200);
      const key = await ready();
      const first = await (await start(key, { branch: 'linked' })).json();
      expect(first.worktree_folder).toBe(join(real, 'subway-reader', 'linked'));
      expect((await post(`/api/tickets/${key}/stop`)).status).toBe(200);
      expect((await (await start(key)).json()).worktree_folder).toBe(first.worktree_folder);
    });

    test('that the slug leaves nothing for is refused, rather than landing on the repository folder', async () => {
      const key = await ready();
      const res = await start(key, { branch: '+.+' });
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toBe(`nothing changed — no Worktree for ${key}: +.+ leaves nothing to name a folder with`);
    });
  });

  describe('repeating a Start converges on one folder', () => {
    const worktreeCount = () => git(repo, 'worktree', 'list', '--porcelain').split('\n\n').length;

    test('a Ticket that was stopped keeps its Worktree and comes back to it, as its default', async () => {
      const key = await ready();
      const first = await (await start(key, { branch: 'mine' })).json();
      const stopped = await (await post(`/api/tickets/${key}/stop`)).json();
      expect(stopped).toMatchObject({ status: 'ready', worktree_branch: 'mine', worktree_folder: first.worktree_folder });
      const again = await (await start(key)).json();
      expect(again).toMatchObject({ status: 'building', worktree_branch: 'mine', worktree_folder: first.worktree_folder });
      expect(worktreeCount()).toBe(2);
    });

    test('a batch that did not commit leaves the Ticket `ready`, and the retry adopts the folder it made', async () => {
      const key = await ready();
      const id = (await read(key)).id;
      h.failWrites('ticket event', id);
      const failed = await start(key, { branch: 'half' });
      expect(failed.status).toBe(500);
      expect(await read(key)).toMatchObject({ status: 'ready', worktree_branch: null, worktree_folder: null });
      expect(branchAt(folderOf('half'))).toBe('half');
      h.healWrites();
      expect(await (await start(key, { branch: 'half' })).json()).toMatchObject({ status: 'building', worktree_branch: 'half', worktree_folder: folderOf('half') });
      expect(worktreeCount()).toBe(2);
      expect((await (await req(`/api/tickets/${key}/events`)).json()).filter((e: { kind: string }) => e.kind === 'transitioned')).toHaveLength(1);
    });

    test('a Ticket asked onto another branch moves to that Worktree and the history says from where', async () => {
      const key = await ready();
      const first = await (await start(key, { branch: 'one' })).json();
      expect((await post(`/api/tickets/${key}/stop`)).status).toBe(200);
      expect(await (await start(key, { branch: 'two' })).json()).toMatchObject({ worktree_branch: 'two', worktree_folder: folderOf('two') });
      expect(existsSync(first.worktree_folder)).toBe(true);
      const [event] = await (await req(`/api/tickets/${key}/events`)).json();
      expect(event.prior).toEqual({ status: 'ready', worktree_branch: 'one', worktree_folder: first.worktree_folder });
    });

    test('a folder deleted by hand is never adopted: the Ticket stays `ready` until git can make it', async () => {
      const key = await ready();
      const { worktree_folder: folder } = await (await start(key, { branch: 'gone' })).json();
      expect((await post(`/api/tickets/${key}/stop`)).status).toBe(200);
      rmSync(folder, { recursive: true, force: true });

      const refused = await start(key);
      expect(refused.status).toBe(409);
      // the sentence and the way out, which git puts on two lines
      expect((await refused.json()).hint).toContain(`'${folder}' is a missing but already registered worktree; use 'add -f' to override, or 'prune' or 'remove' to clear`);
      expect((await read(key)).status).toBe('ready');

      git(repo, 'worktree', 'prune');
      expect(await (await start(key)).json()).toMatchObject({ status: 'building', worktree_folder: folder });
      expect(branchAt(folder)).toBe('gone');
    });
  });

  describe("a failed Worktree leaves the Ticket `ready` and returns git's reason", () => {
    const refused = async (key: string, body: unknown) => {
      const res = await start(key, body);
      expect(res.status).toBe(409);
      const { hint } = await res.json();
      expect(await read(key)).toMatchObject({ status: 'ready', worktree_branch: null, worktree_folder: null });
      expect(await (await req(`/api/tickets/${key}/events`)).json()).toHaveLength(1);
      return hint as string;
    };

    test('a folder already taken', async () => {
      mkdirSync(folderOf('taken'), { recursive: true });
      writeFileSync(join(folderOf('taken'), 'keep'), 'mine');
      const key = await ready();
      expect(await refused(key, { branch: 'taken' })).toContain('already exists');
      expect(readdirSync(folderOf('taken'))).toEqual(['keep']);
    });

    test('a base that does not exist, with no branch left behind', async () => {
      const key = await ready();
      expect(await refused(key, { branch: 'cut', base: 'nope' })).toBe(`nothing changed — no Worktree for ${key}: no branch or commit named nope in ${repo}`);
      expect(branches(repo)).toEqual(['main']);
    });

    test('a base dressed as a flag', async () => {
      const key = await ready();
      expect(await refused(key, { branch: 'cut', base: '--detach' })).toContain('no branch or commit named --detach');
      expect(existsSync(worktrees)).toBe(false);
    });

    test.each(['a..b', '-b', 'trailing.lock', 'has space'])('a branch git would not allow: %j', async (branch) => {
      const key = await ready();
      expect(await refused(key, { branch })).toContain('is not a name git allows for a branch');
      expect(existsSync(worktrees)).toBe(false);
    });

    test('a Checkout that has gone', async () => {
      const key = await ready();
      rmSync(repo, { recursive: true, force: true });
      expect(await refused(key, { branch: 'cut' })).toBe(`nothing changed — no Worktree for ${key}: the Checkout ${repo} is not there`);
    });

    test('no git on the PATH, blaming git and not the Checkout', async () => {
      const key = await ready();
      const PATH = process.env.PATH;
      process.env.PATH = join(scratch, 'nowhere');
      try {
        expect(await refused(key, { branch: 'cut' })).toBe(`nothing changed — no Worktree for ${key}: git is not on the tracker's PATH, so no Worktree can be made in ${repo}`);
      } finally {
        process.env.PATH = PATH;
      }
    });

    test('a Checkout that is no longer a repository', async () => {
      const key = await ready();
      rmSync(join(repo, '.git'), { recursive: true, force: true });
      expect(await refused(key, { branch: 'cut' })).toContain('not a git repository');
    });
  });

  test('every Transition keeps the Worktree, and the list reads carry it', async () => {
    const key = await ready();
    const { worktree_folder: folder } = await (await start(key, { branch: 'kept' })).json();
    const list = await (await req('/api/tickets')).json();
    expect(list[0]).toMatchObject({ worktree_branch: 'kept', worktree_folder: folder });
    expect(await (await post(`/api/tickets/${key}/cancel`)).json()).toMatchObject({ status: 'cancelled', worktree_branch: 'kept', worktree_folder: folder });
    expect(existsSync(folder)).toBe(true);
  });
});
