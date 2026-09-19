import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeTestApp } from '@goblin/api/test/harness';
import { createApp } from '@goblin/api/src/app';
import { openDb } from '@goblin/api/src/db';
import { REPOSITORY_WANTS, TRANSITION_NAMES } from '@goblin/shared';
import { runGoblin, type GoblinDeps } from '../src/run';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

describe('goblin', () => {
  let h: Harness;
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  /**
   * The CLI's own seam (ADR-0004): its handlers against the in-process app,
   * with no socket and no binary. `env` is empty so the shell running the
   * suite cannot set an actor.
   */
  const run = (argv: string[], over: Partial<GoblinDeps> = {}) =>
    runGoblin(argv, { fetch: (path, init) => Promise.resolve(h.app.request(path, init)), env: {}, ...over });

  const json = async (argv: string[], over: Partial<GoblinDeps> = {}) => {
    const result = await run(argv, over);
    expect([argv.join(' '), result.code, result.err]).toEqual([argv.join(' '), 0, '']);
    return JSON.parse(result.out);
  };

  test('a planning session, end to end: app → project → ticket → design → dependency → approve → frontier', async () => {
    const app = await json(['app', 'create', '--name', 'Subway Reader', '--repository-url', 'https://github.com/itsRoze/subway-reader']);
    expect(app).toMatchObject({ id: 1, name: 'Subway Reader' });

    // the GUI's `<slug>-<id>` address works everywhere an id does
    const project = await json(['project', 'create', '--name', 'MVP', '--app', 'subway-reader-1']);
    expect(project).toMatchObject({ id: 1, app_id: 1 });

    // an agent's ticket lands in planning, and the project brings the app with it (ADR-0007)
    const ticket = await json(['ticket', 'create', '--title', 'Parse an RSS feed', '--project', '1', '--actor', 'agent']);
    expect(ticket).toMatchObject({ key: 'GF-1', status: 'planning', app_id: 1, project_id: 1 });

    const design = '# The plan\n\nFetch, parse, store.\n';
    const io = { readFile: async (path: string) => (path === 'plan.md' ? design : Promise.reject(new Error('no such file'))) };
    await json(['ticket', 'design', 'set', 'GF-1', '@plan.md', '--actor', 'agent'], { io });
    // the one non-JSON output: markdown as it was written
    expect((await run(['ticket', 'design', 'get', 'GF-1'])).out).toBe(design);

    const other = await json(['ticket', 'create', '--title', 'Render the list']);
    expect(other).toMatchObject({ key: 'GF-2', status: 'backlog' });
    const blocked = await json(['dependency', 'add', '--blocker', 'GF-1', '--blocked', 'GF-2']);
    expect(blocked.blocked_by).toEqual(['GF-1']);

    // approving what an agent planned is a human act
    const refused = await run(['ticket', 'approve', 'GF-1', '--actor', 'agent']);
    expect(refused.code).toBe(1);
    expect(refused.out).toBe('');
    expect(JSON.parse(refused.err)).toMatchObject({ status: 409, owner: 'human', hint: "approve is the human's move, not the agent's" });

    expect(await json(['ticket', 'approve', 'GF-1'])).toMatchObject({ key: 'GF-1', status: 'ready' });

    // GF-1 is ready with nothing in its way; GF-2 is still in backlog and waiting on it
    expect((await json(['frontier'])).map((t: { key: string }) => t.key)).toEqual(['GF-1']);
    expect((await json(['ticket', 'show', 'GF-2'])).dependencies.depends_on).toEqual([expect.objectContaining({ key: 'GF-1', status: 'ready' })]);
  });

  /**
   * Several keys after a verb are one batch (issue 03b, ADR-0010): the same
   * verb, sent once, committed for the whole set or not at all. One key is the
   * single-ticket call it always was, so nothing about the planning transcript
   * changes.
   */
  test('a transition or a trash with several keys is one atomic batch; one key is the call it always was', async () => {
    await json(['app', 'create', '--name', 'Subway Reader']);
    for (const title of ['one', 'two', 'three']) await json(['ticket', 'create', '--title', title, '--app', '1', '--simple', '--status', 'todo']);

    const approved = await json(['ticket', 'approve', 'GF-1', 'GF-2', '3']);
    expect(approved.tickets.map((t: { key: string; status: string }) => [t.key, t.status])).toEqual([
      ['GF-1', 'ready'],
      ['GF-2', 'ready'],
      ['GF-3', 'ready'],
    ]);
    // one key answers with the ticket itself, as before
    expect(await json(['ticket', 'start', 'GF-1'])).toMatchObject({ key: 'GF-1', status: 'building' });

    // one member that cannot go stops all of them, and the refusal names it
    const refused = await run(['ticket', 'submit', 'GF-1', 'GF-2']);
    expect([refused.code, refused.out]).toEqual([1, '']);
    expect(JSON.parse(refused.err)).toMatchObject({ status: 409, refusals: [{ key: 'GF-2', reason: 'a ticket in ready does not go to review' }] });
    expect((await json(['ticket', 'show', 'GF-1'])).status).toBe('building');

    await json(['ticket', 'trash', 'GF-2', 'GF-3']);
    expect((await json(['trash'])).tickets.map((t: { key: string }) => t.key).sort()).toEqual(['GF-2', 'GF-3']);
    await json(['ticket', 'trash', 'GF-1']);
    expect((await json(['ticket', 'list'])).length).toBe(0);
  });

  test('`ticket move` sends a set to one named place: a project, an app, out of its project, or nowhere', async () => {
    await json(['app', 'create', '--name', 'Subway Reader']);
    await json(['project', 'create', '--name', 'MVP', '--app', '1']);
    await json(['ticket', 'create', '--title', 'one']);
    await json(['ticket', 'create', '--title', 'two']);
    const keys = (r: { tickets: { key: string; app_id: number | null; project_id: number | null }[] }) => r.tickets.map((t) => [t.key, t.app_id, t.project_id]);

    // the project brings its app, for every member; the GUI's slug address works here too
    expect(keys(await json(['ticket', 'move', 'GF-1', 'GF-2', '--project', 'mvp-1']))).toEqual([
      ['GF-1', 1, 1],
      ['GF-2', 1, 1],
    ]);
    expect(keys(await json(['ticket', 'move', 'GF-1', '--project', 'null']))).toEqual([['GF-1', 1, null]]);
    expect(keys(await json(['ticket', 'move', 'GF-2', '--app', '1']))).toEqual([['GF-2', 1, null]]);
    expect(keys(await json(['ticket', 'move', 'GF-1', 'GF-2', '--nowhere']))).toEqual([
      ['GF-1', null, null],
      ['GF-2', null, null],
    ]);

    // exactly one destination, and the CLI says so before anything is sent
    expect((await run(['ticket', 'move', 'GF-1'])).code).toBe(2);
    expect((await run(['ticket', 'move', 'GF-1', '--app', '1', '--nowhere'])).code).toBe(2);
    expect((await run(['ticket', 'move', 'GF-1', '--app', 'null'])).code).toBe(2);
    // a destination the API refuses is its refusal, on `to`
    const gone = await run(['ticket', 'move', 'GF-1', '--project', '99']);
    expect(gone.code).toBe(1);
    expect(JSON.parse(gone.err)).toMatchObject({ status: 422, issues: [{ path: ['action', 'to'] }] });
  });

  test('GF_ACTOR says who is acting when --actor does not', async () => {
    const ticket = await json(['ticket', 'create', '--title', 'planned by the planner'], { env: { GF_ACTOR: 'agent' } });
    expect(ticket.status).toBe('planning');
    const refused = await run(['ticket', 'pick', 'GF-1'], { env: { GF_ACTOR: 'agent' } });
    expect(refused.code).toBe(1);
    // the flag wins over the environment, which is how a human approves in a shell an agent set up
    expect((await run(['ticket', 'pick', 'GF-1', '--actor', 'human'], { env: { GF_ACTOR: 'agent' } })).code).toBe(0);
    expect((await run(['frontier', '--actor', 'robot'])).code).toBe(2);
    // a global may also lead, before the noun
    expect((await json(['--actor', 'agent', 'ticket', 'create', '--title', 'led by a global'])).status).toBe('planning');
  });

  test('long text arrives inline, from a file, or on stdin; `--json` is accepted and ignored', async () => {
    const io = { readFile: async () => 'from a file', readStdin: async () => 'from stdin' };
    await json(['app', 'create', '--name', 'A', '--description', 'inline']);
    await json(['app', 'create', '--name', 'B', '--description', '@notes.md'], { io });
    await json(['app', 'create', '--name', 'C', '--description', '-', '--json'], { io });
    expect((await json(['app', 'list'])).map((a: { description: string }) => a.description)).toEqual(['inline', 'from a file', 'from stdin']);
    expect((await run(['app', 'create', '--name', 'D', '--description', '@nowhere.md'])).code).toBe(2);
  });

  /** The value closest to hand is whatever `git remote -v` printed, and it is stored as typed (GF-8). */
  test('`--repository-url` takes the SSH remote git prints, and teaches when it cannot', async () => {
    const app = await json(['app', 'create', '--name', 'Goblin Foundry', '--repository-url', 'git@github.com:itsRoze/goblin-foundry.git']);
    expect(app).toMatchObject({ repository_url: 'git@github.com:itsRoze/goblin-foundry.git' });

    const refused = await run(['app', 'create', '--name', 'X', '--repository-url', '/Users/roze/dev/x']);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.err).issues).toEqual([{ path: ['repository_url'], message: REPOSITORY_WANTS }]);
  });

  test('`null` clears a nullable field; an update never touches what it does not name', async () => {
    await json(['app', 'create', '--name', 'Subway Reader', '--repository-url', 'https://example.com/r', '--default-branch', 'main']);
    const cleared = await json(['app', 'update', '1', '--default-branch', 'null']);
    expect(cleared).toMatchObject({ name: 'Subway Reader', repository_url: 'https://example.com/r', default_branch: null });

    await json(['ticket', 'create', '--title', 'a ticket']);
    await json(['ticket', 'update', 'GF-1', '--design', '# something']);
    expect((await json(['ticket', 'update', 'GF-1', '--design', 'null'])).design).toBeNull();
  });

  test('the boolean flags: `--simple`, `--no-simple`, `--archived`, `--cascade`', async () => {
    await json(['app', 'create', '--name', 'Subway Reader']);
    const simple = await json(['ticket', 'create', '--title', 'a small one', '--simple', '--app', '1']);
    expect(simple.simple).toBe(true);
    expect((await json(['ticket', 'update', 'GF-1', '--no-simple'])).simple).toBe(false);

    await json(['app', 'archive', '1']);
    expect(await json(['app', 'list'])).toEqual([]);
    expect((await json(['app', 'list', '--archived'])).map((a: { id: number }) => a.id)).toEqual([1]);

    await json(['app', 'trash', '1', '--cascade']);
    const trash = await json(['trash']);
    expect(trash.tickets.map((t: { key: string }) => t.key)).toEqual(['GF-1']);
    expect((await json(['ticket', 'list'])).length).toBe(0);
  });

  /**
   * A route through the lifecycle, written out by hand rather than read off the
   * table, so that a verb the table gains and the CLI misses fails here — and
   * so that this asserts the CLI reaches every verb rather than that the table
   * equals itself.
   */
  const WALK: [string, string][] = [
    ['plan', 'planning'],
    ['pick', 'todo'],
    ['shelve', 'backlog'],
    ['close', 'done'],
    ['cancel', 'cancelled'],
    ['reopen', 'backlog'],
    ['plan', 'planning'],
    ['approve', 'ready'],
    ['unapprove', 'planning'],
    ['approve', 'ready'],
    ['start', 'building'],
    ['stop', 'ready'],
    ['start', 'building'],
    ['submit', 'review'],
    ['ship', 'done'],
  ];

  test('every transition in the shared table is a verb that reaches the API', async () => {
    expect(new Set(WALK.map(([name]) => name))).toEqual(new Set(TRANSITION_NAMES));

    await json(['app', 'create', '--name', 'Subway Reader']);
    await json(['ticket', 'create', '--title', 'a simple one', '--simple', '--app', '1']);
    for (const [name, lands] of WALK) {
      const res = await run(['ticket', name, 'GF-1']);
      expect([name, res.code]).toEqual([name, 0]);
      expect([name, JSON.parse(res.out).status]).toEqual([name, lands]);
    }
  });

  test('filters and history reach the endpoints the board uses', async () => {
    await json(['app', 'create', '--name', 'Subway Reader']);
    await json(['project', 'create', '--name', 'MVP', '--app', '1']);
    await json(['ticket', 'create', '--title', 'in the project', '--project', '1']);
    await json(['ticket', 'create', '--title', 'an orphan idea']);

    expect((await json(['ticket', 'list', '--project', '1'])).map((t: { key: string }) => t.key)).toEqual(['GF-1']);
    expect((await json(['ticket', 'list', '--project', 'null'])).map((t: { key: string }) => t.key)).toEqual(['GF-2']);
    expect((await json(['project', 'list', '--app', '1'])).map((p: { id: number }) => p.id)).toEqual([1]);

    await json(['ticket', 'update', 'GF-1', '--title', 'renamed']);
    expect((await json(['ticket', 'history', 'GF-1'])).map((e: { kind: string }) => e.kind)).toEqual(['updated', 'created']);
    expect((await json(['app', 'history', '1'])).map((e: { kind: string }) => e.kind)).toEqual(['created']);
  });

  test('a project design is markdown in and markdown out, and settings are readable and writable', async () => {
    await json(['project', 'create', '--name', 'MVP']);
    expect((await run(['project', 'design', 'get', '1'])).out).toBe('');
    await json(['project', 'design', 'set', 'mvp-1', '# Subway Reader']);
    expect((await run(['project', 'design', 'get', '1'])).out).toBe('# Subway Reader');

    expect(await json(['settings'])).toEqual({ ticket_prefix: 'GF' });
    expect(await json(['settings', 'set', '--ticket-prefix', 'sr'])).toEqual({ ticket_prefix: 'SR' });
    await json(['ticket', 'create', '--title', 'renumbered nothing']);
    expect((await json(['ticket', 'show', '1'])).key).toBe('SR-1');
  });

  test("a dependency needs both ends, and it is removable", async () => {
    await json(['ticket', 'create', '--title', 'first']);
    await json(['ticket', 'create', '--title', 'second']);
    for (const argv of [
      ['dependency', 'add', '--blocker', 'GF-1'],
      ['dependency', 'add', '--blocked', 'GF-2'],
      ['dependency', 'remove', '--blocked', 'GF-2'],
    ]) {
      const res = await run(argv);
      expect([argv.join(' '), res.code]).toEqual([argv.join(' '), 2]);
      expect(JSON.parse(res.err).detail).toMatch(/^--block(er|ed) is required$/);
    }
    await json(['dependency', 'add', '--blocker', 'GF-1', '--blocked', 'GF-2']);
    expect((await json(['dependency', 'remove', '--blocker', 'GF-1', '--blocked', 'GF-2'])).blocked_by).toEqual([]);
  });

  describe('refusals', () => {
    const badRun = async (argv: string[], over: Partial<GoblinDeps> = {}) => {
      const result = await runGoblin(argv, { fetch: (path, init) => Promise.resolve(h.app.request(path, init)), env: {}, ...over });
      expect(result.out).toBe('');
      return { code: result.code, problem: JSON.parse(result.err) };
    };

    test("the API's own problem+json is relayed verbatim, and stdout stays empty", async () => {
      const { code, problem } = await badRun(['ticket', 'create', '--title', 'straight to the board', '--status', 'backlog', '--actor', 'agent']);
      expect(code).toBe(1);
      expect(problem).toEqual({
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        issues: [{ path: ['status'], message: 'an agent creates a ticket in planning, never backlog' }],
      });
    });

    test('a 404 from the API is exit 1; a mistyped invocation is exit 2', async () => {
      expect((await badRun(['ticket', 'show', 'GF-99'])).code).toBe(1);
      for (const argv of [['banana'], ['ticket', 'banana', 'GF-1'], ['ticket', 'show'], ['ticket', 'show', 'GF-1', '--banana', 'x'], ['ticket', 'show', 'GF-1', 'extra']]) {
        expect([argv.join(' '), (await badRun(argv)).code]).toEqual([argv.join(' '), 2]);
      }
      expect((await badRun(['app', 'show', 'banana'])).problem.detail).toContain('is not an app address');
    });

    test('nothing at the other end is exit 3, and says what to try', async () => {
      const { code, problem } = await badRun(['frontier'], { fetch: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4747')) });
      expect(code).toBe(3);
      expect(problem).toMatchObject({ status: 503, title: 'Service Unavailable', detail: 'connect ECONNREFUSED 127.0.0.1:4747' });
    });

    test('a flag is never another flag\'s value: a typo is refused, not read as text', async () => {
      await json(['ticket', 'create', '--title', 'a ticket']);
      const typo = await badRun(['ticket', 'update', 'GF-1', '--title', '--help']);
      expect(typo.code).toBe(2);
      expect(typo.problem).toMatchObject({ detail: '--title needs a value', hint: 'write --title=<value> if the value itself begins with --' });
      // the escape hatch, for a title that really does begin with --
      expect((await json(['ticket', 'update', 'GF-1', '--title=--help'])).title).toBe('--help');
    });

    test('a failure that is nobody\'s problem+json — a body that is not JSON — is wrapped into the shape too', async () => {
      const { code, problem } = await badRun(['ticket', 'design', 'get', 'GF-1'], {
        fetch: async () => new Response('not json at all', { status: 200 }),
      });
      expect(code).toBe(1);
      expect(problem).toMatchObject({ type: 'about:blank', title: 'Internal Error', status: 500 });
      expect(typeof problem.detail).toBe('string');
    });

    test('a failure that is not problem+json is wrapped into the same shape', async () => {
      const { code, problem } = await badRun(['frontier'], {
        fetch: async () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } }),
      });
      expect(code).toBe(1);
      expect(problem).toEqual({ type: 'about:blank', title: 'Bad Gateway', status: 502, detail: '<html>Bad Gateway</html>' });
    });
  });

  describe('help', () => {
    test('every noun and every command answers --help, and nothing is documented that is not there', async () => {
      const root = await run(['--help']);
      expect(root.code).toBe(0);
      for (const noun of ['app', 'project', 'ticket', 'dependency', 'frontier', 'trash', 'settings', 'backup', 'service']) {
        expect(root.out).toContain(`  ${noun}`);
        const help = await run([noun, '--help']);
        expect([noun, help.code]).toEqual([noun, 0]);
        expect(help.out).toContain(`usage: goblin ${noun} <verb>`);
      }
      const create = await run(['ticket', 'create', '--help']);
      expect(create.out).toContain('usage: goblin ticket create --title <title> [--description <text|@path|->]');
      expect(create.out).toContain('--simple');
      // creation is design-less (issue 07): writing one is a second call
      expect(create.out).not.toContain('--design');
      // help answers before what is required is checked — you ask because you do not know
      expect(create.err).toBe('');

      const verbs = await run(['ticket', '--help']);
      for (const name of TRANSITION_NAMES) expect([name, verbs.out.includes(`\n  ${name} `)]).toEqual([name, true]);
    });

    test('a bare `goblin` is a usage refusal, not a wall of text', async () => {
      const bare = await run([]);
      expect(bare.code).toBe(2);
      expect(bare.out).toBe('');
      expect(JSON.parse(bare.err)).toMatchObject({ title: 'Usage', detail: 'goblin needs a noun', hint: 'try `goblin --help`' });
    });
  });

  describe('the filter flags (issue 06)', () => {
    /** Two apps, a project, and one ticket in every shape the flags have to tell apart. */
    const seed = async () => {
      await json(['app', 'create', '--name', 'Subway Reader']);
      await json(['app', 'create', '--name', 'Other']);
      await json(['project', 'create', '--name', 'MVP', '--app', '1']);
      await json(['ticket', 'create', '--title', 'orphan']);
      await json(['ticket', 'create', '--title', 'parse a feed', '--project', '1', '--description', 'rss and atom']);
      await json(['ticket', 'create', '--title', 'somebody else', '--app', '2']);
      await json(['ticket', 'create', '--title', 'ready to go', '--app', '1', '--simple', '--status', 'ready']);
    };
    const titles = async (argv: string[]) => (await json(argv)).map((t: { title: string }) => t.title);

    test('`ticket list` narrows by app, project, status and text, and the four compose', async () => {
      await seed();
      expect(await titles(['ticket', 'list'])).toEqual(['orphan', 'parse a feed', 'somebody else', 'ready to go']);
      expect(await titles(['ticket', 'list', '--app', 'subway-reader-1'])).toEqual(['parse a feed', 'ready to go']);
      expect(await titles(['ticket', 'list', '--project', '1'])).toEqual(['parse a feed']);
      expect(await titles(['ticket', 'list', '--status', 'ready,backlog'])).toEqual(['orphan', 'parse a feed', 'somebody else', 'ready to go']);
      expect(await titles(['ticket', 'list', '--status', 'ready'])).toEqual(['ready to go']);
      expect(await titles(['ticket', 'list', '--q', 'RSS'])).toEqual(['parse a feed']);
      expect(await titles(['ticket', 'list', '--app', '1', '--status', 'backlog', '--q', 'feed'])).toEqual(['parse a feed']);
      expect(await titles(['ticket', 'list', '--app', 'null'])).toEqual(['orphan']);
    });

    test('`frontier` takes the same flags, minus the one it has already answered', async () => {
      await seed();
      await json(['ticket', 'create', '--title', 'also ready', '--project', '1', '--simple', '--status', 'ready']);
      expect(await titles(['frontier'])).toEqual(['ready to go', 'also ready']);
      expect(await titles(['frontier', '--app', '1'])).toEqual(['ready to go', 'also ready']);
      expect(await titles(['frontier', '--project', '1'])).toEqual(['also ready']);
      expect(await titles(['frontier', '--q', 'also'])).toEqual(['also ready']);
      // `--status` is not a frontier flag at all, so the parser refuses it before anything is sent
      expect((await run(['frontier', '--status', 'ready'])).code).toBe(2);
    });

    test('a mistyped status is a usage error: nothing was sent, so the exit code says so', async () => {
      const refused = await run(['ticket', 'list', '--status', 'shipped']);
      expect(refused.code).toBe(2);
      expect(refused.out).toBe('');
      expect(JSON.parse(refused.err)).toMatchObject({ title: 'Usage', detail: '--status: shipped is not a status' });
    });
  });

  describe('backup', () => {
    let dir: string;
    const saved = process.env.GF_DB_PATH;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'gf-backup-'));
      // `backup` copies the file rather than calling the API, and finds it the way the server does
      process.env.GF_DB_PATH = h.path;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.GF_DB_PATH;
      else process.env.GF_DB_PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    });

    test('writes a dated copy that openDb opens and that has the data in it', async () => {
      await json(['app', 'create', '--name', 'Subway Reader']);
      const written = await json(['backup', dir]);
      expect(basename(written.path)).toMatch(/^foundry-\d{4}-\d{2}-\d{2}T\d{6}\.db$/);
      expect(written.source).toBe(h.path);
      expect(written.bytes).toBeGreaterThan(0);

      const copy = await openDb(written.path);
      try {
        const apps = await (await createApp(copy.db).request('/api/apps')).json();
        expect(apps).toEqual([expect.objectContaining({ id: 1, name: 'Subway Reader' })]);
      } finally {
        copy.close();
      }
    });

    test('a directory that is not there is refused before anything is written', async () => {
      const missing = await run(['backup', join(dir, 'nope')]);
      expect(missing.code).toBe(2);
      expect(JSON.parse(missing.err)).toMatchObject({ title: 'Usage', detail: `${join(dir, 'nope')} is not a directory` });
      expect((await run(['backup'])).code).toBe(2);
    });
  });
});
