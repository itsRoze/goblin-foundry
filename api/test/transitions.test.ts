import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TICKET_STATUSES, TRANSITIONS, TRANSITION_NAMES, findTransition, type TicketStatus, type TransitionName } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('POST /api/tickets/:key/:name', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const patch = (path: string, body: unknown) => req(path, json('PATCH', body));
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  /** A ticket parked at `status`, walked there by the table so no test writes a status by hand. */
  const at = async (status: TicketStatus, over: Record<string, unknown> = {}) => {
    const app = await post('/api/apps', { name: `app-${Math.random()}` }).then((r) => r.json());
    const t = await post('/api/tickets', { title: `a ticket for ${status}`, app_id: app.id, ...over }).then((r) => r.json());
    if (t.status !== status) {
      await patch(`/api/tickets/${t.key}`, { design: 'the plan' });
      for (const name of ROUTE[status]) {
        const res = await post(`/api/tickets/${t.key}/${name}`);
        expect([res.status, name]).toEqual([200, name]);
      }
    }
    return { ...(await req(`/api/tickets/${t.key}`).then((r) => r.json())), app_id: app.id };
  };

  /** How to walk from `backlog` to each status using nothing but legal edges. */
  const ROUTE: Record<TicketStatus, TransitionName[]> = {
    backlog: [],
    todo: ['pick'],
    planning: ['plan'],
    ready: ['pick', 'approve'],
    building: ['pick', 'approve', 'start'],
    review: ['pick', 'approve', 'start', 'submit'],
    done: ['pick', 'approve', 'start', 'submit', 'ship'],
    cancelled: ['cancel'],
  };

  test('every edge in the table is accepted and lands the ticket on its `to`', async () => {
    for (const edge of TRANSITIONS) {
      const t = await at(edge.from);
      const res = await post(`/api/tickets/${t.key}/${edge.name}`);
      expect([res.status, `${edge.from} -${edge.name}->`]).toEqual([200, `${edge.from} -${edge.name}->`]);
      expect((await res.json()).status).toBe(edge.to);
    }
  });

  test('a name that is not in the table is a 404, even on a live ticket', async () => {
    const t = await at('backlog');
    const res = await post(`/api/tickets/${t.key}/promote`);
    expect(res.status).toBe(404);
    expect((await res.json()).detail).toBe('no transition named promote');
  });

  test('a name in the table with no edge from this status is a 409 naming the owner and the status pair', async () => {
    const t = await at('review');
    const res = await post(`/api/tickets/${t.key}/start`);
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ owner: 'human', hint: 'a ticket in review does not go back to building' });
  });

  test('a move to the status the ticket is already in is refused too', async () => {
    const t = await at('ready');
    const res = await post(`/api/tickets/${t.key}/stop`);
    expect(res.status).toBe(409);
    expect((await res.json()).hint).toBe('a ticket in ready is already in ready');
  });

  test('a transition on an unknown or trashed ticket is a 404, and `restore` is still the un-trash', async () => {
    expect((await post('/api/tickets/GF-99/pick')).status).toBe(404);
    const t = await at('backlog');
    await req(`/api/tickets/${t.key}`, { method: 'DELETE' });
    expect((await post(`/api/tickets/${t.key}/pick`)).status).toBe(404);
    const restored = await post(`/api/tickets/${t.key}/restore`);
    expect(restored.status).toBe(200);
    expect((await restored.json()).trashed_at).toBe(null);
  });

  test('the approve guard names an app, a design, or both', async () => {
    const orphan = await post('/api/tickets', { title: 'no home', status: 'todo' }).then((r) => r.json());
    expect((await (await post(`/api/tickets/${orphan.key}/approve`)).json()).hint).toBe('approve needs an app and a ticket design');

    const app = await post('/api/apps', { name: 'Reader' }).then((r) => r.json());
    await patch(`/api/tickets/${orphan.key}`, { app_id: app.id });
    expect((await (await post(`/api/tickets/${orphan.key}/approve`)).json()).hint).toBe('approve needs a ticket design');

    await patch(`/api/tickets/${orphan.key}`, { design: '   \n  ' });
    expect((await (await post(`/api/tickets/${orphan.key}/approve`)).json()).hint).toBe('approve needs a ticket design');

    await patch(`/api/tickets/${orphan.key}`, { design: '# plan' });
    expect((await post(`/api/tickets/${orphan.key}/approve`)).status).toBe(200);
  });

  test('simple bypasses the design but never the app', async () => {
    const orphan = await post('/api/tickets', { title: 'quick fix', status: 'todo', simple: true }).then((r) => r.json());
    expect((await (await post(`/api/tickets/${orphan.key}/approve`)).json()).hint).toBe('approve needs an app');
    const app = await post('/api/apps', { name: 'Reader' }).then((r) => r.json());
    await patch(`/api/tickets/${orphan.key}`, { app_id: app.id });
    const res = await post(`/api/tickets/${orphan.key}/approve`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ready');
  });

  test('close is unguarded — a ticket with nothing on it still records as done', async () => {
    const bare = await post('/api/tickets', { title: 'turned out to be done' }).then((r) => r.json());
    const res = await post(`/api/tickets/${bare.key}/close`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('done');
  });

  test('a transition writes one `transitioned` event carrying the verb and the status pair', async () => {
    const t = await at('backlog');
    await post(`/api/tickets/${t.key}/pick`);
    expect((await events(t.key))[0]).toMatchObject({
      kind: 'transitioned',
      actor: 'human',
      prior: { status: 'backlog' },
      new: { status: 'todo', transition: 'pick' },
    });
  });

  test('a refused transition writes nothing', async () => {
    const t = await at('backlog');
    const before = (await events(t.key)).length;
    await post(`/api/tickets/${t.key}/ship`);
    expect((await events(t.key)).length).toBe(before);
  });

  // who may move a ticket at all is `actor.test.ts`; this is only about where the answer is read from
  test('the actor comes from the header, not the body — and in S1 the header decides whether the move happens', async () => {
    const t = await at('backlog');
    const asAgent = await req(`/api/tickets/${t.key}/pick`, { method: 'POST', headers: { 'x-goblin-actor': 'agent' } });
    expect(asAgent.status).toBe(409);
    const claiming = await post(`/api/tickets/${t.key}/pick`, { actor: 'agent' });
    expect(claiming.status).toBe(200);
    expect((await events(t.key))[0]).toMatchObject({ kind: 'transitioned', actor: 'human' });
  });

  test('the whole matrix: every (status, name) pair off the table is a 409', async () => {
    const refused: string[] = [];
    for (const from of TICKET_STATUSES) {
      for (const name of TRANSITION_NAMES) {
        if (findTransition(from, name)) continue; // acceptance is the first test's business
        const t = await at(from); // a fresh ticket per pair, so a refusal is never a side effect of an earlier one
        const res = await post(`/api/tickets/${t.key}/${name}`);
        expect([`${from}/${name}`, res.status]).toEqual([`${from}/${name}`, 409]);
        refused.push(`${from}/${name}`);
      }
    }
    expect(refused).toHaveLength(TICKET_STATUSES.length * TRANSITION_NAMES.length - TRANSITIONS.length);
  });
});

describe('the approve guard at creation and on edit', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const patch = (path: string, body: unknown) => req(path, json('PATCH', body));

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const newApp = () => post('/api/apps', { name: 'Reader' }).then((r) => r.json());

  test('creation into `done` or `cancelled` is refused outright', async () => {
    for (const status of ['done', 'cancelled'] as const) {
      const res = await post('/api/tickets', { title: 'declared finished', status });
      expect(res.status).toBe(422);
      expect((await res.json()).issues).toEqual([{ path: ['status'], message: `a ticket is never created in ${status} — it is earned, not declared` }]);
    }
  });

  test('creation into `ready`, `building` or `review` runs the guard', async () => {
    const app = await newApp();
    for (const status of ['ready', 'building', 'review'] as const) {
      const orphan = await post('/api/tickets', { title: 'born there', status });
      expect(orphan.status).toBe(422);
      expect((await orphan.json()).issues).toEqual([{ path: ['status'], message: `a ticket in ${status} needs an app and a ticket design` }]);

      // a design cannot be given at creation, so only a simple ticket may be born past `planning`
      const withApp = await post('/api/tickets', { title: 'born there', status, app_id: app.id });
      expect((await withApp.json()).issues).toEqual([{ path: ['status'], message: `a ticket in ${status} needs a ticket design` }]);

      const simple = await post('/api/tickets', { title: 'born there', status, app_id: app.id, simple: true });
      expect(simple.status).toBe(201);
      expect((await simple.json()).status).toBe(status);
    }
  });

  test('creation into the planning end of the lifecycle is unguarded', async () => {
    for (const status of ['backlog', 'todo', 'planning'] as const) {
      const res = await post('/api/tickets', { title: 'an idea', status });
      expect(res.status).toBe(201);
      expect((await res.json()).status).toBe(status);
    }
  });

  test('clearing the app at `ready` is refused, naming the field and unapprove', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'quick fix', status: 'ready', app_id: app.id, simple: true }).then((r) => r.json());
    const res = await patch(`/api/tickets/${t.key}`, { app_id: null });
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: ['app_id'], message: 'a ticket in ready needs an app — unapprove it first' }]);
    expect((await req(`/api/tickets/${t.key}`).then((r) => r.json())).app_id).toBe(app.id);
  });

  test('un-flagging simple with no design is refused, and blamed on `simple`', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'quick fix', status: 'building', app_id: app.id, simple: true }).then((r) => r.json());
    const res = await patch(`/api/tickets/${t.key}`, { simple: false });
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: ['simple'], message: 'a ticket in building needs a ticket design — unapprove it first' }]);
  });

  test('un-flagging simple is fine in the same breath as giving the ticket a design', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'quick fix', status: 'ready', app_id: app.id, simple: true }).then((r) => r.json());
    expect((await patch(`/api/tickets/${t.key}`, { design: '# the plan', simple: false })).status).toBe(200);
    // and once it is the design that holds the ticket up, taking the design away is what the guard refuses
    const gone = await patch(`/api/tickets/${t.key}`, { design: null });
    expect(gone.status).toBe(422);
    expect((await gone.json()).issues).toEqual([{ path: ['design'], message: 'a ticket in ready needs a ticket design — unapprove it first' }]);
  });

  test('a simple ticket may clear a design it never needed', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'quick fix', status: 'ready', app_id: app.id, simple: true }).then((r) => r.json());
    await patch(`/api/tickets/${t.key}`, { design: 'notes I no longer want' });
    expect((await patch(`/api/tickets/${t.key}`, { design: null })).status).toBe(200);
  });

  test('the guard does not hold below `ready`: a planning ticket may lose its app', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'an idea', status: 'planning', app_id: app.id }).then((r) => r.json());
    expect((await patch(`/api/tickets/${t.key}`, { app_id: null })).status).toBe(200);
  });

  test('an edit unrelated to the guard is untouched by it', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'quick fix', status: 'ready', app_id: app.id, simple: true }).then((r) => r.json());
    expect((await patch(`/api/tickets/${t.key}`, { title: 'quicker fix', description: 'why' })).status).toBe(200);
  });
});
