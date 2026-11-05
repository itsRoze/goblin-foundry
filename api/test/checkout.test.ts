import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe("an App's Checkout, against real git", () => {
  let h: Harness;
  /** Real, because macOS's temp dir is reached through a symlink and git answers with where it actually is. */
  let root: string;
  let repo: string;

  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], {
      cwd,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  };
  const makeRepo = (name: string) => {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    return dir;
  };
  const createApp = async (fields: Record<string, unknown> = {}) => (await req('/api/apps', json('POST', { name: 'Subway Reader', ...fields }))).json();
  const setCheckout = (id: number, checkout: string | null, headers?: Record<string, string>) => req(`/api/apps/${id}`, json('PATCH', { checkout }, headers));
  const readApp = async (id: number) => (await req(`/api/apps/${id}`)).json();

  beforeEach(async () => {
    h = await makeTestApp();
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-checkout-')));
    repo = makeRepo('subway-reader');
  });
  afterEach(() => {
    h.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('an App has no Checkout until one is set, and a folder inside a repository records its top level', async () => {
    const app = await createApp();
    expect(app.checkout).toBeNull();

    const inside = join(repo, 'src', 'deep');
    mkdirSync(inside, { recursive: true });
    const res = await setCheckout(app.id, inside);
    expect(res.status).toBe(200);
    expect((await res.json()).checkout).toBe(repo);
    expect((await readApp(app.id)).checkout).toBe(repo);
  });

  test('a linked worktree of a repository records the repository, not a folder that will be cleaned up', async () => {
    writeFileSync(join(repo, 'README'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'first');
    const linked = join(root, 'linked');
    git(repo, 'worktree', 'add', '-q', '-b', 'side', linked);
    const app = await createApp();
    expect((await (await setCheckout(app.id, linked)).json()).checkout).toBe(repo);
  });

  test("`~` is this machine's home, the way a person types a folder", async () => {
    const app = await createApp();
    // the real home, reached past: a test has no business making a repository in it
    expect((await (await setCheckout(app.id, `~/${relative(homedir(), repo)}`)).json()).checkout).toBe(repo);
    const typo = `~/${relative(homedir(), join(root, 'typo'))}`;
    expect((await (await setCheckout(app.id, typo)).json()).issues).toEqual([{ path: ['checkout'], message: `no folder at ${typo}` }]);
  });

  test('a create records it too, and clearing it leaves everything else alone', async () => {
    const app = await createApp({ repository_url: 'https://example.com/r', default_branch: 'main', checkout: repo });
    expect(app.checkout).toBe(repo);
    const cleared = await setCheckout(app.id, null);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ checkout: null, repository_url: 'https://example.com/r', default_branch: 'main' });
    expect((await readApp(app.id)).checkout).toBeNull();
  });

  test("clearing doesn't need the folder to still be there", async () => {
    const elsewhere = makeRepo('moved-away');
    const app = await createApp({ checkout: elsewhere });
    rmSync(elsewhere, { recursive: true, force: true });
    expect((await readApp(app.id)).checkout).toBe(elsewhere);
    expect((await (await setCheckout(app.id, null)).json()).checkout).toBeNull();
  });

  test('a monorepo: two Apps may record the same Checkout', async () => {
    const first = await createApp({ checkout: repo });
    const second = await createApp({ name: 'Subway Writer', checkout: repo });
    expect([first.checkout, second.checkout]).toEqual([repo, repo]);
    expect((await readApp(first.id)).checkout).toBe(repo);
  });

  describe("the App's history", () => {
    const historyOf = async (id: number) => (await (await req(`/api/apps/${id}/events`)).json()) as { kind: string; actor: string; prior: unknown; new: unknown }[];

    test("a change is one entry with its Actor, and each Actor's are their own (one Actor's within five minutes are one sitting, ADR-0008)", async () => {
      const app = await createApp();
      const other = makeRepo('other');
      expect((await setCheckout(app.id, repo, { 'x-goblin-actor': 'agent' })).status).toBe(200);
      expect((await setCheckout(app.id, other)).status).toBe(200);
      expect(await historyOf(app.id)).toMatchObject([
        { kind: 'updated', actor: 'human', prior: { checkout: repo }, new: { checkout: other } },
        { kind: 'updated', actor: 'agent', prior: { checkout: null }, new: { checkout: repo } },
        { kind: 'created', actor: 'human', new: { checkout: null } },
      ]);
    });

    test('clearing is an entry too', async () => {
      const app = await createApp({ checkout: repo });
      expect((await setCheckout(app.id, null, { 'x-goblin-actor': 'agent' })).status).toBe(200);
      expect(await historyOf(app.id)).toMatchObject([
        { kind: 'updated', actor: 'agent', prior: { checkout: repo }, new: { checkout: null } },
        { kind: 'created', new: { checkout: repo } },
      ]);
    });

    test('naming a folder of the repository already recorded is no change', async () => {
      const app = await createApp({ checkout: repo });
      const inside = join(repo, 'src');
      mkdirSync(inside);
      expect((await (await setCheckout(app.id, inside)).json()).checkout).toBe(repo);
      expect(await historyOf(app.id)).toHaveLength(1);
    });
  });

  describe('a folder that cannot be a Checkout is refused with a sentence saying why, and nothing is saved', () => {
    const refusalOf = async (res: Response) => {
      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      return (await res.json()).issues;
    };

    const cases: [string, () => string, (folder: string) => string][] = [
      ['a path that does not exist', () => join(root, 'typo'), (f) => `no folder at ${f}`],
      ['a file', () => { const f = join(root, 'a-file'); writeFileSync(f, ''); return f; }, (f) => `${f} is a file, not a folder`],
      ['a folder outside any repository', () => { const f = join(root, 'plain'); mkdirSync(f); return f; }, (f) => `${f} is not inside a git repository`],
      ['a relative path, which means nothing to a server', () => 'dev/subway-reader', () => 'wants an absolute path, not dev/subway-reader'],
      ['an absolute path with a NUL', () => '/nul\0path', (f) => `no folder at ${f}`],
    ];

    for (const [what, folder, sentence] of cases) {
      test(`${what}, on an edit`, async () => {
        const app = await createApp({ checkout: repo });
        const f = folder();
        expect(await refusalOf(await setCheckout(app.id, f))).toEqual([{ path: ['checkout'], message: sentence(f) }]);
        expect((await readApp(app.id)).checkout).toBe(repo);
        expect(await (await req(`/api/apps/${app.id}/events`)).json()).toHaveLength(1);
      });
    }

    test('on a create, which makes no App', async () => {
      const f = join(root, 'typo');
      expect(await refusalOf(await req('/api/apps', json('POST', { name: 'X', checkout: f })))).toEqual([{ path: ['checkout'], message: `no folder at ${f}` }]);
      expect(await (await req('/api/apps')).json()).toEqual([]);
    });

    test('an empty one, which says what the field wants rather than how long it is', async () => {
      const app = await createApp();
      expect(await refusalOf(await setCheckout(app.id, '   '))).toEqual([{ path: ['checkout'], message: 'wants a folder on this machine' }]);
    });

    test("a bare repository has no working folder, and git's own reason says so", async () => {
      const app = await createApp();
      const bare = join(root, 'bare.git');
      mkdirSync(bare);
      git(bare, 'init', '-q', '--bare');
      const [issue] = await refusalOf(await setCheckout(app.id, bare));
      expect(issue.message).toBe(`git cannot use ${bare}: this operation must be run in a work tree`);
    });

    test('without git on PATH, the refusal blames git and not the folder', async () => {
      const app = await createApp();
      const PATH = process.env.PATH;
      process.env.PATH = join(root, 'nowhere');
      try {
        const [issue] = await refusalOf(await setCheckout(app.id, repo));
        expect(issue.message).toBe(`git is not on the tracker's PATH, so ${repo} cannot be checked`);
      } finally {
        process.env.PATH = PATH;
      }
      expect((await readApp(app.id)).checkout).toBeNull();
    });
  });
});
