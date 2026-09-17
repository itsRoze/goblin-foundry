import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BulkAction, TicketStatus, TransitionName } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, actor?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(actor ? { 'X-Goblin-Actor': actor } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/**
 * ADR-0010: one action on a set of Tickets commits for the whole set or
 * changes nothing. Every assertion about "nothing" is made the way a client
 * would make it — by reading the tickets and their history back.
 */
describe('POST /api/tickets/bulk', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown, actor?: string) => req(path, json('POST', body, actor));
  const patch = (path: string, body: unknown) => req(path, json('PATCH', body));
  const read = (key: string) => req(`/api/tickets/${key}`).then((r) => r.json());
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());
  const bulk = (tickets: string[], action: BulkAction | Record<string, unknown>, actor?: string) => post('/api/tickets/bulk', { tickets, action }, actor);

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const newApp = (name = `app-${Math.random()}`) => post('/api/apps', { name }).then((r) => r.json());
  const newProject = (body: Record<string, unknown>) => post('/api/projects', { name: `project-${Math.random()}`, ...body }).then((r) => r.json());

  /** How to walk from `backlog` to each status using nothing but legal edges. */
  const ROUTE: Partial<Record<TicketStatus, TransitionName[]>> = {
    backlog: [],
    todo: ['pick'],
    planning: ['plan'],
    ready: ['pick', 'approve'],
    building: ['pick', 'approve', 'start'],
    cancelled: ['cancel'],
  };

  /** A ticket parked at `status`, with everything the approve guard wants unless `over` takes it away. */
  const at = async (status: TicketStatus, over: Record<string, unknown> = {}) => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: `a ticket for ${status}`, app_id: app.id, ...over }).then((r) => r.json());
    if (!('design' in over)) await patch(`/api/tickets/${t.key}`, { design: 'the plan' });
    for (const name of ROUTE[status] ?? []) expect([(await post(`/api/tickets/${t.key}/${name}`)).status, name]).toEqual([200, name]);
    return read(t.key);
  };

  /** Everything a refusal must leave alone: the tickets as read, and each one's history. */
  const snapshot = async (keys: string[]) => Promise.all(keys.map(async (key) => ({ ticket: await read(key), events: await events(key) })));

  describe('transitions', () => {
    test('one named intent is applied across different source statuses, with one history event each', async () => {
      const todo = await at('todo');
      const planning = await at('planning');
      const res = await bulk([todo.key, planning.key], { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tickets.map((t: { key: string; status: string }) => [t.key, t.status])).toEqual([
        [todo.key, 'ready'],
        [planning.key, 'ready'],
      ]);
      expect((await read(todo.key)).status).toBe('ready');
      expect((await read(planning.key)).status).toBe('ready');
      expect((await events(todo.key))[0]).toMatchObject({ kind: 'transitioned', actor: 'human', prior: { status: 'todo' }, new: { status: 'ready', transition: 'approve' } });
      expect((await events(planning.key))[0]).toMatchObject({ kind: 'transitioned', prior: { status: 'planning' }, new: { status: 'ready', transition: 'approve' } });
    });

    test('a member with no such arrow refuses the whole set with the table’s sentence — a shared destination is not enough', async () => {
      const todo = await at('todo');
      const building = await at('building');
      const before = await snapshot([todo.key, building.key]);
      // `approve` and `stop` both land on `ready`; only one of them was asked for
      const res = await bulk([todo.key, building.key], { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(409);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      const problem = await res.json();
      expect(problem.refusals).toEqual([{ key: building.key, reason: 'a ticket in building does not go back to ready' }]);
      expect(problem.hint).toContain(building.key);
      expect(await snapshot([todo.key, building.key])).toEqual(before);
    });

    test('a guard one member fails refuses every member, naming each that lacks something', async () => {
      const fine = await at('todo');
      const noDesign = await at('planning', { design: undefined });
      const orphan = await post('/api/tickets', { title: 'an orphan', status: 'todo', simple: true }).then((r) => r.json());
      const keys = [fine.key, noDesign.key, orphan.key];
      const before = await snapshot(keys);
      const res = await bulk(keys, { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(409);
      expect((await res.json()).refusals).toEqual([
        { key: noDesign.key, reason: 'approve needs a ticket design' },
        { key: orphan.key, reason: 'approve needs an app' },
      ]);
      expect(await snapshot(keys)).toEqual(before);
    });

    test('an agent owns no edge in a batch either, and is not told what the tickets lack', async () => {
      const a = await at('todo');
      const b = await at('planning', { design: undefined });
      const before = await snapshot([a.key, b.key]);
      const res = await bulk([a.key, b.key], { kind: 'transition', name: 'approve' }, 'agent');
      expect(res.status).toBe(409);
      const problem = await res.json();
      expect(problem.owner).toBe('human');
      expect(problem.refusals).toEqual([
        { key: a.key, reason: "approve is the human's move, not the agent's" },
        { key: b.key, reason: "approve is the human's move, not the agent's" },
      ]);
      expect(await snapshot([a.key, b.key])).toEqual(before);
    });

    test('a name that is not in the table is a 422 on the action, never a status edit', async () => {
      const t = await at('todo');
      const res = await bulk([t.key], { kind: 'transition', name: 'promote' });
      expect(res.status).toBe(422);
      expect((await res.json()).issues[0].path).toEqual(['action', 'name']);
      const smuggled = await bulk([t.key], { kind: 'transition', name: 'approve', status: 'done' });
      expect(smuggled.status).toBe(422);
      expect((await read(t.key)).status).toBe('todo');
    });
  });

  describe('the submitted set', () => {
    test('a missing or trashed member refuses the whole set', async () => {
      const live = await at('todo');
      const trashed = await at('todo');
      await req(`/api/tickets/${trashed.key}`, { method: 'DELETE' });
      const before = await snapshot([live.key]);
      const res = await bulk([live.key, trashed.key, 'GF-999'], { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(409);
      expect((await res.json()).refusals).toEqual([
        { key: trashed.key, reason: `ticket ${trashed.key} is in the trash` },
        { key: 'GF-999', reason: 'ticket GF-999 not found' },
      ]);
      expect(await snapshot([live.key])).toEqual(before);
    });

    test('keys are as lenient as everywhere else, a repeated ticket counts once, and nonsense is a 422', async () => {
      const t = await at('todo');
      const res = await bulk([String(t.id), `SR-${t.id}`, t.key], { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(200);
      expect((await res.json()).tickets).toHaveLength(1);
      expect((await events(t.key)).filter((e: { new: { transition?: string } }) => e.new.transition === 'approve')).toHaveLength(1);

      const bad = await bulk(['not a key'], { kind: 'trash' });
      expect(bad.status).toBe(422);
      expect((await bad.json()).issues[0].path).toEqual(['tickets', 0]);
      expect((await bulk([], { kind: 'trash' })).status).toBe(422);
    });
  });

  describe('moves', () => {
    test('a project brings its app, for every member', async () => {
      const app = await newApp('Reader');
      const project = await newProject({ app_id: app.id });
      const orphan = await post('/api/tickets', { title: 'an orphan' }).then((r) => r.json());
      const elsewhere = await at('backlog');
      const res = await bulk([orphan.key, elsewhere.key], { kind: 'move', to: { kind: 'project', id: project.id } });
      expect(res.status).toBe(200);
      for (const key of [orphan.key, elsewhere.key]) expect(await read(key)).toMatchObject({ app_id: app.id, project_id: project.id });
      expect((await events(orphan.key))[0]).toMatchObject({ kind: 'updated', prior: { app_id: null, project_id: null }, new: { app_id: app.id, project_id: project.id } });
    });

    test('an app clears project membership, even a project of that same app', async () => {
      const app = await newApp('Reader');
      const project = await newProject({ app_id: app.id });
      const inProject = await post('/api/tickets', { title: 'in the project', project_id: project.id }).then((r) => r.json());
      const other = await at('backlog');
      const res = await bulk([inProject.key, other.key], { kind: 'move', to: { kind: 'app', id: app.id } });
      expect(res.status).toBe(200);
      for (const key of [inProject.key, other.key]) expect(await read(key)).toMatchObject({ app_id: app.id, project_id: null });
    });

    test('remove from project keeps each app; nowhere clears both', async () => {
      const app = await newApp('Reader');
      const project = await newProject({ app_id: app.id });
      const a = await post('/api/tickets', { title: 'a', project_id: project.id }).then((r) => r.json());
      const b = await post('/api/tickets', { title: 'b', project_id: project.id }).then((r) => r.json());
      expect((await bulk([a.key, b.key], { kind: 'move', to: { kind: 'no-project' } })).status).toBe(200);
      for (const key of [a.key, b.key]) expect(await read(key)).toMatchObject({ app_id: app.id, project_id: null });
      expect((await bulk([a.key, b.key], { kind: 'move', to: { kind: 'nowhere' } })).status).toBe(200);
      for (const key of [a.key, b.key]) expect(await read(key)).toMatchObject({ app_id: null, project_id: null });
    });

    test('a member already there is left alone, without a history event of its own', async () => {
      const app = await newApp('Reader');
      const there = await post('/api/tickets', { title: 'already there', app_id: app.id }).then((r) => r.json());
      const coming = await post('/api/tickets', { title: 'coming' }).then((r) => r.json());
      const before = await events(there.key);
      expect((await bulk([there.key, coming.key], { kind: 'move', to: { kind: 'app', id: app.id } })).status).toBe(200);
      expect(await events(there.key)).toEqual(before);
      expect((await read(coming.key)).app_id).toBe(app.id);
    });

    test('a destination that is archived, trashed or missing refuses the whole move on `to`', async () => {
      const archived = await newApp('Archived');
      await post(`/api/apps/${archived.id}/archive`);
      const a = await at('backlog');
      const b = await at('backlog');
      const before = await snapshot([a.key, b.key]);
      const res = await bulk([a.key, b.key], { kind: 'move', to: { kind: 'app', id: archived.id } });
      expect(res.status).toBe(422);
      expect((await res.json()).issues).toEqual([{ path: ['action', 'to'], message: `app ${archived.id} is archived` }]);
      expect((await bulk([a.key], { kind: 'move', to: { kind: 'project', id: 999 } })).status).toBe(422);
      expect(await snapshot([a.key, b.key])).toEqual(before);
    });

    test('a trashed app, an archived project and a trashed project are all refused on `to`, the same way', async () => {
      const app = await newApp('Reader');
      const gone = await newApp('Gone');
      await req(`/api/apps/${gone.id}`, { method: 'DELETE' });
      const shelved = await newProject({ app_id: app.id });
      await post(`/api/projects/${shelved.id}/archive`);
      const binned = await newProject({ app_id: app.id });
      await req(`/api/projects/${binned.id}`, { method: 'DELETE' });
      const t = await at('backlog');
      const before = await snapshot([t.key]);
      const refused = async (to: Record<string, unknown>) => {
        const res = await bulk([t.key], { kind: 'move', to });
        return [res.status, (await res.json()).issues];
      };
      expect(await refused({ kind: 'app', id: gone.id })).toEqual([422, [{ path: ['action', 'to'], message: `app ${gone.id} is in the trash` }]]);
      expect(await refused({ kind: 'project', id: shelved.id })).toEqual([422, [{ path: ['action', 'to'], message: `project ${shelved.id} is archived` }]]);
      expect(await refused({ kind: 'project', id: binned.id })).toEqual([422, [{ path: ['action', 'to'], message: `project ${binned.id} is in the trash` }]]);
      expect(await snapshot([t.key])).toEqual(before);
    });

    test('a move that would take the app from a ticket in ready refuses every member', async () => {
      const ready = await at('ready');
      const idea = await at('backlog');
      const before = await snapshot([ready.key, idea.key]);
      const res = await bulk([idea.key, ready.key], { kind: 'move', to: { kind: 'nowhere' } });
      expect(res.status).toBe(409);
      expect((await res.json()).refusals).toEqual([{ key: ready.key, reason: 'a ticket in ready needs an app — unapprove it first' }]);
      expect(await snapshot([ready.key, idea.key])).toEqual(before);
    });

    test('a move joins the edit session a single edit would have joined (ADR-0008)', async () => {
      const app = await newApp('Reader');
      const t = await post('/api/tickets', { title: 'edited then moved' }).then((r) => r.json());
      await patch(`/api/tickets/${t.key}`, { title: 'edited, then moved' });
      const sessions = (await events(t.key)).length;
      expect((await bulk([t.key], { kind: 'move', to: { kind: 'app', id: app.id } })).status).toBe(200);
      const after = await events(t.key);
      expect(after).toHaveLength(sessions);
      expect(after[0]).toMatchObject({ kind: 'updated', prior: { title: 'edited then moved', app_id: null }, new: { title: 'edited, then moved', app_id: app.id } });
    });
  });

  describe('trash', () => {
    test('every member goes to the trash, each with its own event, and restores one by one', async () => {
      const a = await at('backlog');
      const b = await at('ready');
      const res = await bulk([a.key, b.key], { kind: 'trash' });
      expect(res.status).toBe(200);
      for (const key of [a.key, b.key]) expect((await req(`/api/tickets/${key}`)).status).toBe(404);
      const trash = await req('/api/trash').then((r) => r.json());
      expect(trash.tickets.map((t: { key: string }) => t.key).sort()).toEqual([a.key, b.key].sort());
      expect((await post(`/api/tickets/${a.key}/restore`)).status).toBe(200);
      expect((await events(a.key)).map((e: { kind: string }) => e.kind).slice(0, 2)).toEqual(['restored', 'trashed']);
    });
  });

  /**
   * Validation-only refusals cannot prove atomicity — nothing was written when
   * they fired. These make a write fail *after* earlier writes in the same
   * batch have run, with a trigger in the database itself (the storage
   * boundary; no application interface knows about it).
   */
  describe('rollback', () => {
    test('a history write that fails part-way leaves every ticket and every history untouched', async () => {
      const first = await at('todo');
      const second = await at('planning');
      const third = await at('todo');
      const keys = [first.key, second.key, third.key];
      const before = await snapshot(keys);
      // the first ticket's update and event, and the second ticket's update, have all run by the time this fires
      h.failWrites('event', second.id);
      const res = await bulk(keys, { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      expect((await res.json()).detail).toContain('nothing changed');
      expect(await snapshot(keys)).toEqual(before);
      // and the same batch goes through once the fault is gone: nothing was left half-held
      h.healWrites();
      expect((await bulk(keys, { kind: 'transition', name: 'approve' })).status).toBe(200);
      for (const key of keys) expect((await read(key)).status).toBe('ready');
    });

    test('a ticket write that fails after others succeeded rolls those back, for a move and for trash', async () => {
      const app = await newApp('Reader');
      const first = await at('backlog');
      const last = await at('backlog');
      const before = await snapshot([first.key, last.key]);
      h.failWrites('ticket', last.id);
      expect((await bulk([first.key, last.key], { kind: 'move', to: { kind: 'app', id: app.id } })).status).toBe(500);
      expect((await bulk([first.key, last.key], { kind: 'trash' })).status).toBe(500);
      expect(await snapshot([first.key, last.key])).toEqual(before);
      expect((await req('/api/trash').then((r) => r.json())).tickets).toEqual([]);
    });

    test('a member that changed between the judging and the commit stops the batch, and is named', async () => {
      const first = await at('todo');
      const moved = await at('todo');
      const before = await snapshot([first.key, moved.key]);
      // from inside the batch, a row that changed underneath it is a write that matches nothing
      h.failWrites('ticket', moved.id, 'vanish');
      const res = await bulk([first.key, moved.key], { kind: 'transition', name: 'approve' });
      expect(res.status).toBe(409);
      expect((await res.json()).refusals).toEqual([{ key: moved.key, reason: `ticket ${moved.key} changed while the batch was being applied — try again` }]);
      expect(await snapshot([first.key, moved.key])).toEqual(before);
    });

    test('the destination is held to what was judged: a project that changes under the batch stops the move', async () => {
      const app = await newApp('Reader');
      const project = await newProject({ app_id: app.id });
      const a = await at('backlog');
      const b = await at('backlog');
      const before = await snapshot([a.key, b.key]);
      h.failWrites('project', project.id, 'vanish');
      const res = await bulk([a.key, b.key], { kind: 'move', to: { kind: 'project', id: project.id } });
      expect(res.status).toBe(409);
      expect((await res.json()).hint).toContain(`project ${project.id} changed`);
      expect(await snapshot([a.key, b.key])).toEqual(before);
    });

    test('a single-ticket write racing a failing batch is neither lost nor rolled back with it', async () => {
      const a = await at('todo');
      const b = await at('todo');
      const bystander = await at('backlog');
      h.failWrites('event', b.id);
      const [batch, single] = await Promise.all([bulk([a.key, b.key], { kind: 'transition', name: 'approve' }), post(`/api/tickets/${bystander.key}/pick`)]);
      expect(batch.status).toBe(500);
      expect(single.status).toBe(200);
      expect((await read(bystander.key)).status).toBe('todo');
      expect((await read(a.key)).status).toBe('todo');
    });
  });
});
