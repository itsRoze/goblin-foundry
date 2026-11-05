import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { TerminalOutcome } from '@goblin/shared';
import { event } from '../src/schema';
import { noTerminal, type TerminalRequest, type TerminalSteps } from '../src/terminal';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

const AUTHOR = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

/** A terminal step that writes down what it was asked and answers what it is told to. */
function recordingStep(answer: (asked: TerminalRequest) => TerminalOutcome = () => ({ opened: true })) {
  const asked: TerminalRequest[] = [];
  return {
    asked,
    step: {
      open: async (request: TerminalRequest) => {
        asked.push(request);
        return answer(request);
      },
    },
  };
}

describe('the terminal step setting', () => {
  let h: Harness;
  afterEach(() => h.close());
  const patch = (body: unknown) => Promise.resolve(h.app.request('/api/settings', { ...json('PATCH', body), headers: { 'content-type': 'application/json', 'x-goblin-actor': 'agent' } }));
  const settings = async () => (await h.app.request('/api/settings')).json();

  test('defaults to none', async () => {
    h = await makeTestApp();
    expect((await settings()).terminal_step).toBe('none');
  });

  test('a name that is no step at all is refused', async () => {
    h = await makeTestApp();
    expect((await patch({ terminal_step: 'iterm' })).status).toBe(422);
  });

  test('`herdr` can be chosen, and the choice is in the history with its Actor', async () => {
    h = await makeTestApp();
    const res = await patch({ terminal_step: 'herdr' });
    expect(res.status).toBe(200);
    expect((await res.json()).terminal_step).toBe('herdr');
    expect((await settings()).terminal_step).toBe('herdr');
    const history = await h.db.select({ actor: event.actor, kind: event.kind, prior: event.prior, new: event.new }).from(event).where(and(eq(event.entity_kind, 'setting'), eq(event.entity_id, 0)));
    expect(history).toEqual([{ actor: 'agent', kind: 'updated', prior: { terminal_step: 'none' }, new: { terminal_step: 'herdr' } }]);
  });
});

describe('Start and Open terminal ask the terminal step, against real git', () => {
  let h: Harness;
  let scratch: string;
  let repo: string;
  let worktrees: string;
  let recorder: ReturnType<typeof recordingStep>;

  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const read = async (key: string) => (await req(`/api/tickets/${key}`)).json();
  const events = async (key: string) => (await req(`/api/tickets/${key}/events`)).json();
  const terminal = (key: string, body?: unknown) => post(`/api/tickets/${key}/terminal`, body);

  const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...AUTHOR } });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
    return run.stdout.toString().trim();
  };
  const folderOf = (slug: string) => join(worktrees, 'subway-reader', slug);

  const useSteps = async (steps: Partial<TerminalSteps>) => {
    h?.close();
    h = await makeTestApp({ terminals: steps });
    expect((await req('/api/settings', json('PATCH', { worktree_root: worktrees }))).status).toBe(200);
  };
  const appWith = async (fields: Record<string, unknown> = {}) => (await post('/api/apps', { name: 'Subway Reader', checkout: repo, ...fields })).json();
  const ticketIn = async (status: string, app: { id: number } | null, title = 'Parse the feed') =>
    (await (await post('/api/tickets', { title, status, simple: true, ...(app && { app_id: app.id }) })).json()).key as string;

  beforeEach(async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gf-terminal-')));
    repo = join(scratch, 'subway-reader');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    worktrees = join(scratch, 'worktrees');
    recorder = recordingStep();
    h = undefined as unknown as Harness;
    await useSteps({ none: recorder.step });
  });
  afterEach(() => {
    h.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('Start', () => {
    test('a Start that made a Worktree asks the step last, and answers with the Ticket and the outcome', async () => {
      const app = await appWith();
      const key = await ticketIn('ready', app);
      const branch = `${key.toLowerCase()}-parse-the-feed`;
      const res = await post(`/api/tickets/${key}/start`, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ key, status: 'building', worktree_branch: branch, worktree_folder: folderOf(branch), terminal: { opened: true } });
      expect(recorder.asked).toEqual([{ app: { id: app.id, name: 'Subway Reader' }, ticket: { key, title: 'Parse the feed' }, folder: folderOf(branch) }]);
    });

    test('a terminal that did not open is not an error: the Ticket is building with its Worktree, and the reason and folder come back', async () => {
      recorder = recordingStep(({ folder }) => ({ opened: false, reason: 'Herdr is not running', folder }));
      await useSteps({ none: recorder.step });
      const key = await ticketIn('ready', await appWith());
      const branch = `${key.toLowerCase()}-parse-the-feed`;
      const res = await post(`/api/tickets/${key}/start`, {});
      expect(res.status).toBe(200);
      expect((await res.json()).terminal).toEqual({ opened: false, reason: 'Herdr is not running', folder: folderOf(branch) });
      expect(await read(key)).toMatchObject({ status: 'building', worktree_branch: branch });
    });

    test('a step that throws is a terminal that did not open, not a failed Start', async () => {
      await useSteps({
        none: {
          open: () => {
            throw new Error('the socket went away');
          },
        },
      });
      const key = await ticketIn('ready', await appWith());
      const branch = `${key.toLowerCase()}-parse-the-feed`;
      const res = await post(`/api/tickets/${key}/start`, {});
      expect(res.status).toBe(200);
      expect((await res.json()).terminal).toEqual({ opened: false, reason: 'the socket went away', folder: folderOf(branch) });
      expect((await read(key)).status).toBe('building');
    });

    test('the installation asks the step its setting names', async () => {
      const herdr = recordingStep();
      await useSteps({ none: recorder.step, herdr: herdr.step });
      expect((await req('/api/settings', json('PATCH', { terminal_step: 'herdr' }))).status).toBe(200);
      await post(`/api/tickets/${await ticketIn('ready', await appWith())}/start`, {});
      expect(recorder.asked).toHaveLength(0);
      expect(herdr.asked).toHaveLength(1);
    });

    test('a bare start asks no step and answers with the Ticket alone', async () => {
      const key = await ticketIn('ready', await appWith());
      const res = await post(`/api/tickets/${key}/start`);
      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty('terminal');
      expect(recorder.asked).toEqual([]);
    });

    test('a refused Start asks no step', async () => {
      const key = await ticketIn('ready', await appWith({ checkout: null, name: 'No Repo' }));
      expect((await post(`/api/tickets/${key}/start`, {})).status).toBe(409);
      expect(recorder.asked).toEqual([]);
    });

    test('the default `none` answers a Start with the folder', async () => {
      await useSteps({ none: noTerminal });
      const key = await ticketIn('ready', await appWith());
      const branch = `${key.toLowerCase()}-parse-the-feed`;
      const res = await post(`/api/tickets/${key}/start`, {});
      expect((await res.json()).terminal).toEqual({ opened: false, reason: 'the terminal step is none, so no terminal was opened', folder: folderOf(branch) });
    });
  });

  describe('Open terminal on a Ticket with a Worktree', () => {
    const started = async (body: unknown = {}) => {
      const app = await appWith();
      const key = await ticketIn('ready', app);
      expect((await post(`/api/tickets/${key}/start`, body)).status).toBe(200);
      recorder.asked.length = 0;
      return { key, app, ticket: await read(key) };
    };

    test('asks the step for that folder, reports the outcome, and changes nothing: no Status, no history', async () => {
      const { key, app, ticket } = await started();
      const before = await events(key);
      const res = await terminal(key);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ key, status: 'building', worktree_folder: ticket.worktree_folder, terminal: { opened: true } });
      expect(recorder.asked).toEqual([{ app: { id: app.id, name: 'Subway Reader' }, ticket: { key, title: 'Parse the feed' }, folder: ticket.worktree_folder }]);
      expect(await events(key)).toEqual(before);
      expect((await read(key)).updated_at).toBe(ticket.updated_at);
    });

    test('works on a review Ticket as well', async () => {
      const { key } = await started();
      expect((await post(`/api/tickets/${key}/submit`)).status).toBe(200);
      const res = await terminal(key);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('review');
    });

    test('refuses, with the folder named, when the recorded folder no longer exists, and asks no step', async () => {
      const { key, ticket } = await started();
      rmSync(ticket.worktree_folder, { recursive: true, force: true });
      const res = await terminal(key);
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toBe(`nothing opened — the Worktree folder of ${key} no longer exists: ${ticket.worktree_folder}; git worktree prune, then git worktree add with that folder and ${ticket.worktree_branch}, brings it back`);
      expect(recorder.asked).toEqual([]);
    });

    test('a Ticket has one Worktree, so a different branch is refused and the base has nothing to do', async () => {
      const { key, ticket } = await started({ branch: 'mine' });
      const res = await terminal(key, { branch: 'other' });
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toBe(`nothing changed — ${key} already has its Worktree, on mine`);
      expect(recorder.asked).toEqual([]);
      expect((await terminal(key, { branch: 'mine', base: 'main' })).status).toBe(200);
      expect(recorder.asked[0]?.folder).toBe(ticket.worktree_folder);
    });

    test('with its App trashed there is nothing to ask for, and the folder is still said', async () => {
      const { key, app, ticket } = await started();
      expect((await req(`/api/apps/${app.id}`, { method: 'DELETE' })).ok).toBe(true);
      const res = await terminal(key);
      expect(res.status).toBe(200);
      expect((await res.json()).terminal).toEqual({ opened: false, reason: `${key} has no App, so no terminal was opened`, folder: ticket.worktree_folder });
      expect(recorder.asked).toEqual([]);
    });
  });

  describe('Open terminal on a Ticket with no Worktree', () => {
    /** Started plainly, as an agent starts one, so it is in flight with nowhere recorded. */
    const inFlight = async (status: 'building' | 'review' = 'building', fields: Record<string, unknown> = {}) => {
      const app = await appWith(fields);
      const key = await ticketIn('ready', app);
      expect((await post(`/api/tickets/${key}/start`)).status).toBe(200);
      if (status === 'review') expect((await post(`/api/tickets/${key}/submit`)).status).toBe(200);
      return { key, app };
    };

    test('with every default it makes the Worktree, records it with one event and its Actor, keeps the Status, then asks the step', async () => {
      const { key, app } = await inFlight();
      const branch = `${key.toLowerCase()}-parse-the-feed`;
      const before = await events(key);
      const res = await req(`/api/tickets/${key}/terminal`, { method: 'POST', headers: { 'x-goblin-actor': 'agent' } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ key, status: 'building', worktree_branch: branch, worktree_folder: folderOf(branch), terminal: { opened: true } });
      expect(git(folderOf(branch), 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
      expect(recorder.asked).toEqual([{ app: { id: app.id, name: 'Subway Reader' }, ticket: { key, title: 'Parse the feed' }, folder: folderOf(branch) }]);
      const after = await events(key);
      expect(after).toHaveLength(before.length + 1);
      expect(after[0]).toMatchObject({
        actor: 'agent',
        kind: 'worktree_recorded',
        prior: { worktree_branch: null, worktree_folder: null },
        new: { worktree_branch: branch, worktree_folder: folderOf(branch) },
      });
    });

    test('takes the same branch and base as Start, on a review Ticket too', async () => {
      git(repo, 'branch', 'develop');
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
      const { key } = await inFlight('review');
      const res = await terminal(key, { branch: 'feature/one', base: 'develop' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'review', worktree_branch: 'feature/one', worktree_folder: folderOf('feature-one') });
      expect(git(repo, 'rev-parse', 'feature/one')).toBe(git(repo, 'rev-parse', 'develop'));
    });

    test('a second press returns to the same place and writes nothing more', async () => {
      const { key } = await inFlight();
      const first = await (await terminal(key)).json();
      const before = await events(key);
      const second = await (await terminal(key)).json();
      expect(second.worktree_folder).toBe(first.worktree_folder);
      expect(await events(key)).toEqual(before);
    });

    test("a failed Worktree records nothing and asks no step, with git's reason", async () => {
      const { key } = await inFlight();
      const res = await terminal(key, { branch: 'bad..name' });
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toContain('is not a name git allows for a branch');
      expect(await read(key)).toMatchObject({ status: 'building', worktree_branch: null, worktree_folder: null });
      expect(recorder.asked).toEqual([]);
    });

    test('with no Checkout on the App it is refused with the same sentence Start gives', async () => {
      const { key } = await inFlight('building', { checkout: null, name: 'No Repo' });
      const res = await terminal(key);
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toContain('No Repo has no Checkout');
      expect(recorder.asked).toEqual([]);
    });

    test('an event that cannot be written rolls the record back, and no step is asked', async () => {
      const { key } = await inFlight();
      const { id } = await read(key);
      h.failWrites('ticket event', id);
      expect((await terminal(key)).status).not.toBe(200);
      h.healWrites();
      expect((await read(key)).worktree_branch).toBeNull();
      expect(recorder.asked).toEqual([]);
    });
  });

  describe('Open terminal refuses', () => {
    test.each(['backlog', 'todo', 'planning', 'ready'] as const)('a %s Ticket, with a sentence, making no folder', async (status) => {
      const key = await ticketIn(status, await appWith());
      const res = await terminal(key);
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toBe(`nothing opened — ${key} is ${status}, and only a building or review Ticket opens a terminal`);
      expect(existsSync(worktrees)).toBe(false);
      expect(recorder.asked).toEqual([]);
    });

    test('a stopped Ticket keeps its Worktree and still has to be started again', async () => {
      const key = await ticketIn('ready', await appWith());
      expect((await post(`/api/tickets/${key}/start`, {})).status).toBe(200);
      recorder.asked.length = 0;
      expect((await post(`/api/tickets/${key}/stop`)).status).toBe(200);
      expect((await terminal(key)).status).toBe(409);
      expect(recorder.asked).toEqual([]);
    });

    test('a done or cancelled Ticket, whose Worktree is left alone', async () => {
      const key = await ticketIn('ready', await appWith());
      expect((await post(`/api/tickets/${key}/start`, {})).status).toBe(200);
      expect((await post(`/api/tickets/${key}/cancel`)).status).toBe(200);
      const res = await terminal(key);
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toContain('is cancelled');
    });

    test('an unknown Ticket is a 404, and a malformed body a 422', async () => {
      expect((await terminal('GF-999')).status).toBe(404);
      const key = await ticketIn('ready', await appWith());
      expect((await terminal(key, { folder: '/elsewhere' })).status).toBe(422);
    });
  });
});
