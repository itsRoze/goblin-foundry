#!/usr/bin/env bun
/**
 * A tracker to look at: the built GUI, the API on a free port, a scratch
 * database seeded with one small world. For the ui-closeout skill, and for
 * anyone who wants a screen to point a browser at without touching
 * ~/.goblin-foundry/foundry.db.
 *
 *   bun .claude/skills/ui-closeout/serve.ts start [--no-build]   prints JSON: url, routes, pid, dir, log
 *   bun .claude/skills/ui-closeout/serve.ts status
 *   bun .claude/skills/ui-closeout/serve.ts stop
 *
 * Talks to the API only (ADR-0004), importing nothing from the workspaces: a
 * refactor inside api/ cannot break it, a change to the API contract will,
 * loudly. State lives in .impeccable/ui-closeout.json (gitignored); the
 * server, its database and its log live in one gf-screen-* directory under
 * the OS temp dir, which `stop` removes.
 */
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..', '..');
const STATE = join(ROOT, '.impeccable', 'ui-closeout.json');
const SCRATCH_PREFIX = 'gf-screen-';

type State = { pid: number; port: number; url: string; dir: string; db: string; log: string; routes: Record<string, string> };

const command = process.argv[2] ?? 'start';
const flags = new Set(process.argv.slice(3));

async function start() {
  const existing = readState();
  if (existing) {
    if (await ours(existing)) {
      console.error(`already running at ${existing.url} (pid ${existing.pid}); \`stop\` first`);
      process.exit(1);
    }
    // a crashed or rebooted session left its state behind
    removeScratch(existing.dir);
    unlinkSync(STATE);
  }
  if (!existsSync(join(ROOT, 'node_modules'))) {
    console.error('no node_modules here yet; run `bun install` first');
    process.exit(1);
  }
  if (!flags.has('--no-build')) {
    const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
    if (build.exitCode !== 0) process.exit(build.exitCode);
  }
  if (!existsSync(join(ROOT, 'web', 'dist', 'index.html'))) {
    console.error('web/dist is missing; run without --no-build');
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
  const db = join(dir, 'foundry.db');
  const log = join(dir, 'server.log');
  const fd = openSync(log, 'a');
  // GF_PORT=0 lets the OS pick the port and the server announce it, so nobody can take it in between
  const proc = Bun.spawn(['bun', 'api/src/server.ts'], {
    cwd: ROOT,
    env: { ...process.env, GF_DB_PATH: db, GF_PORT: '0' },
    stdout: fd,
    stderr: fd,
  });
  proc.unref();

  try {
    const port = await announcedPort(log, proc, 30_000);
    const url = `http://127.0.0.1:${port}`;
    await waitFor(`${url}/api/settings`, 30_000);
    // the state is on disk before seeding, so `stop` can always find the server
    const state: State = { pid: proc.pid, port, url, dir, db, log, routes: {} };
    writeState(state);
    state.routes = await seed(url);
    writeState(state);
    console.log(JSON.stringify(state, null, 2));
  } catch (err) {
    proc.kill();
    let tail = '';
    try { tail = readFileSync(log, 'utf8').split('\n').slice(-20).join('\n'); } catch { /* no log */ }
    removeScratch(dir);
    if (existsSync(STATE)) unlinkSync(STATE);
    console.error(`could not bring the screen up: ${err instanceof Error ? err.message : err}\n${tail}`);
    process.exit(1);
  }
}

async function stop() {
  const state = readState();
  if (!state) {
    console.log('nothing running');
    return;
  }
  if (await ours(state)) process.kill(state.pid, 'SIGTERM');
  removeScratch(state.dir);
  unlinkSync(STATE);
  console.log(`stopped ${state.url} (pid ${state.pid}); scratch database removed`);
}

async function status() {
  const state = readState();
  if (!state) console.log('nothing running');
  else console.log(JSON.stringify({ ...state, alive: await ours(state) }, null, 2));
}

function readState(): State | null {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8')) as State;
  } catch {
    return null;
  }
}

function writeState(state: State) {
  mkdirSync(join(ROOT, '.impeccable'), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2));
}

/** The pid in the state file is ours only while it is a `bun api/src/server.ts` that answers on our URL — pids get reused. */
async function ours(state: State): Promise<boolean> {
  const ps = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(state.pid)]);
  if (!ps.stdout.toString().includes('api/src/server.ts')) return false;
  try {
    return (await fetch(`${state.url}/api/settings`)).ok;
  } catch {
    return false;
  }
}

/** Only ever a gf-screen-* directory under the temp dir; the state file is hand-editable. */
function removeScratch(dir: string) {
  const abs = resolve(dir);
  if (abs.startsWith(resolve(tmpdir())) && basename(abs).startsWith(SCRATCH_PREFIX)) rmSync(abs, { recursive: true, force: true });
}

/** server.ts prints `goblin-foundry  http://127.0.0.1:<port>  db=…` once it is bound. */
async function announcedPort(log: string, proc: { exitCode: number | null }, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`the API exited with code ${proc.exitCode}`);
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(readFileSync(log, 'utf8'));
    if (m) return Number(m[1]);
    await Bun.sleep(100);
  }
  throw new Error(`the API never announced a port within ${timeoutMs}ms`);
}

async function waitFor(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(250);
  }
  throw new Error(`${url} never answered within ${timeoutMs}ms`);
}

// ─── the world ────────────────────────────────────────────────────────────────

const PROJECT_DESIGN = `# Subway Reader MVP

An offline RSS reader for the phone in your pocket, built for a commute with no signal.

## Shape

- **Feeds** are fetched while there is a connection and read while there is none.
- **Articles** are stored whole; images are fetched lazily and never block the text.
- **Reading** is paginated like paper, not scrolled like a website.

## Open questions

- [ ] What does *read* mean for a feed that never marks items read?
- [x] E-ink or not: e-ink first, the phone second.

## Sync

\`\`\`ts
schedule({ every: '15m', when: 'online', budget: '2 MB' });
\`\`\`

> A feed that fails three times in a row is parked, not retried forever.

The parsers considered are in [the foundry's research notes](https://github.com/itsRoze/goblin-foundry).
`;

const TICKET_DESIGN = `# Article view

## Behaviour

1. A tap on the right half turns the page; the left half turns back.
2. Font size is a setting, not a gesture.
3. The last page shows the next article's title, never a blank.

## Not in this slice

- Images beyond the first
- Text selection
`;

const FEED_LIST_DESCRIPTION = `One row per feed: title, unread count in \`mono\`, the newest article's age. Sorted by newest article, not by name, because the question on the platform is *what is new*, not *where is that feed*.

- A feed with nothing unread goes \`mute\`, not hidden.
- A feed that failed its last three fetches gets the outline glyph.
- Pull to refresh only when online; offline the gesture says so and does nothing.
`;

const LONG_TITLE =
  'Handle feeds whose titles run to a full sentence and then some, because real feeds are named by people who never think about the width of a card';

type Json = Record<string, unknown>;

async function seed(base: string): Promise<Record<string, string>> {
  const api = async (method: string, path: string, body?: Json, actor: 'human' | 'agent' = 'human') => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-goblin-actor': actor },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as Json & { id: number; key?: string };
  };
  const ticket = (title: string, fields: Json = {}) => api('POST', '/tickets', { title, ...fields });
  const move = async (key: string, ...names: string[]) => {
    for (const name of names) await api('POST', `/tickets/${key}/${name}`);
  };

  const reader = await api('POST', '/apps', {
    name: 'Subway Reader',
    // the SSH remote git prints, so the App view's longest repository line and its derived link are on screen (GF-8)
    repository_url: 'git@github.com:itsRoze/subway-reader.git',
    default_branch: 'main',
    description: 'An offline RSS reader for the phone in your pocket. Fixture data for looking at screens; nothing here is real.',
  });
  await api('POST', '/apps', { name: 'Goblin Foundry', repository_url: 'https://github.com/itsRoze/goblin-foundry', default_branch: 'main', description: 'The factory tracks itself.' });
  const mvp = await api('POST', '/projects', { name: 'MVP', app_id: reader.id, description: 'The first slice that reads a feed on the subway.', design: PROJECT_DESIGN });
  await api('POST', '/projects', { name: 'Later', app_id: reader.id, description: 'Everything the MVP said no to.' });
  const spike = await api('POST', '/projects', { name: 'Spike: feed parsers', app_id: reader.id, description: 'Three parsers, one afternoon. Settled.' });
  await api('POST', `/projects/${spike.id}/archive`);

  const inMvp = { project_id: mvp.id };
  const scaffold = await ticket('Repo scaffold and CI', { ...inMvp, status: 'ready', simple: true });
  const article = await ticket('Article view with e-ink pagination', { ...inMvp, status: 'planning' });
  const sync = await ticket('Background sync every fifteen minutes', inMvp);
  const feedList = await ticket('Feed list screen', { ...inMvp, status: 'todo', simple: true, description: FEED_LIST_DESCRIPTION });
  const cache = await ticket('Offline cache of article bodies', { ...inMvp, status: 'ready', simple: true });
  const settings = await ticket('Settings screen', { ...inMvp, status: 'ready', simple: true });
  await ticket('OPML import', inMvp);
  const darkMode = await ticket('Dark mode toggle', inMvp);
  await ticket('What if the reader read articles aloud on the train'); // an orphan: an idea with no app
  await ticket(LONG_TITLE, inMvp);
  await ticket('Feed fixture parser tests', { ...inMvp, status: 'ready', simple: true }); // the one card on the ready frontier
  await ticket('Reader settings sync', { ...inMvp, status: 'planning' }); // stays in planning: the one approval waiting
  const accident = await ticket('Created by accident', inMvp);

  await move(scaffold.key!, 'start', 'submit', 'ship');
  await api('PATCH', `/tickets/${article.key}`, { design: TICKET_DESIGN }, 'agent');
  await move(article.key!, 'approve');
  await api('POST', `/tickets/${article.key}/dependencies`, { blocker: sync.key });
  await move(cache.key!, 'start');
  await move(settings.key!, 'start', 'submit');
  await move(darkMode.key!, 'cancel');
  await api('DELETE', `/tickets/${accident.key}`);

  return {
    board: '/',
    ticketBlockedWithDesign: `/tickets/${article.key}`,
    ticketWithDescription: `/tickets/${feedList.key}`,
    project: `/projects/mvp-${mvp.id}`,
    app: `/apps/subway-reader-${reader.id}`,
    apps: '/apps',
    projects: '/projects',
    settings: '/settings',
    trash: '/trash',
  };
}

// ─── dispatch, last so every declaration above is initialised ─────────────────

if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'status') await status();
else {
  console.error('usage: serve.ts start [--no-build] | status | stop');
  process.exit(2);
}
