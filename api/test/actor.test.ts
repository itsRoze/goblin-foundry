import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TICKET_STATUSES, transitionsFrom } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, actor?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(actor ? { 'X-Goblin-Actor': actor } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/**
 * CONTEXT.md "Actor": the hands, never the authority. An agent's reach ends at
 * `planning` — it creates only there, and it owns no transition, so the ready
 * frontier is only ever reached by a human's hand. Both halves refuse; neither
 * corrects.
 */
describe("an agent's reach ends at planning", () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown, actor?: string) => req(path, json('POST', body, actor));
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const newApp = () => post('/api/apps', { name: 'Reader' }).then((r) => r.json());

  test('an agent creating a ticket with no status lands it in planning, recorded as the agent', async () => {
    const res = await post('/api/tickets', { title: 'planned by the planner' }, 'agent');
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.status).toBe('planning');
    expect((await events(created.key))[0]).toMatchObject({ kind: 'created', actor: 'agent', new: { status: 'planning' } });
  });

  test('an agent asking for any other status is refused on `status`, and nothing is created', async () => {
    const res = await post('/api/tickets', { title: 'straight to the board', status: 'backlog' }, 'agent');
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).issues).toEqual([{ path: ['status'], message: 'an agent creates a ticket in planning, never backlog' }]);
    expect(await req('/api/tickets').then((r) => r.json())).toEqual([]);
  });

  test('an agent may say `planning` out loud', async () => {
    const res = await post('/api/tickets', { title: 'planned by the planner', status: 'planning' }, 'agent');
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe('planning');
  });

  test('a human still creates anywhere the guard allows, defaulting to backlog', async () => {
    expect((await post('/api/tickets', { title: 'an idea' }).then((r) => r.json())).status).toBe('backlog');
    const app = await newApp();
    const ready = await post('/api/tickets', { title: 'a simple one', status: 'ready', simple: true, app_id: app.id });
    expect((await ready.json()).status).toBe('ready');
  });

  test('approving what an agent planned is a human act: the agent is refused with the owner and a hint', async () => {
    const app = await newApp();
    const t = await post('/api/tickets', { title: 'planned by the planner', app_id: app.id }, 'agent').then((r) => r.json());
    await req(`/api/tickets/${t.key}`, json('PATCH', { design: '# the plan' }, 'agent'));

    const refused = await post(`/api/tickets/${t.key}/approve`, undefined, 'agent');
    expect(refused.status).toBe(409);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    expect(await refused.json()).toMatchObject({ owner: 'human', hint: "approve is the human's move, not the agent's" });
    expect((await req(`/api/tickets/${t.key}`).then((r) => r.json())).status).toBe('planning');
    expect((await events(t.key)).some((e: { kind: string }) => e.kind === 'transitioned')).toBe(false);

    const approved = await post(`/api/tickets/${t.key}/approve`);
    expect(approved.status).toBe(200);
    expect((await approved.json()).status).toBe('ready');
    expect((await events(t.key))[0]).toMatchObject({ kind: 'transitioned', actor: 'human', new: { status: 'ready', transition: 'approve' } });
  });

  test('it is the whole table, not just approve: every edge out of backlog is refused to an agent', async () => {
    for (const edge of transitionsFrom('backlog')) {
      // created by a human, because an agent's own ticket is never in backlog
      const t = await post('/api/tickets', { title: `an agent tries ${edge.name}` }).then((r) => r.json());
      const res = await post(`/api/tickets/${t.key}/${edge.name}`, undefined, 'agent');
      expect([edge.name, res.status]).toEqual([edge.name, 409]);
      expect([edge.name, (await res.json()).hint]).toEqual([edge.name, `${edge.name} is the human's move, not the agent's`]);
      expect([edge.name, (await req(`/api/tickets/${t.key}`).then((r) => r.json())).status]).toEqual([edge.name, 'backlog']);
    }
  });

  test('a verb with no edge from here is the same structural refusal for anyone — an owner lives on an edge, and there is none', async () => {
    const t = await post('/api/tickets', { title: 'planned by the planner' }, 'agent').then((r) => r.json());
    for (const actor of [undefined, 'agent']) {
      const res = await post(`/api/tickets/${t.key}/ship`, undefined, actor);
      expect([actor, (await res.json()).hint]).toEqual([actor, 'a ticket in planning does not go to done']);
    }
  });

  test('authority is asked before requirements: an agent hears whose move it is, not what the ticket lacks', async () => {
    const t = await post('/api/tickets', { title: 'no app, no design' }, 'agent').then((r) => r.json());
    expect((await post(`/api/tickets/${t.key}/approve`, undefined, 'agent').then((r) => r.json())).hint).toBe("approve is the human's move, not the agent's");
    expect((await post(`/api/tickets/${t.key}/approve`).then((r) => r.json())).hint).toBe('approve needs an app and a ticket design');
  });

  test('an unknown verb is still a 404 for an agent — there is no authority over a move that does not exist', async () => {
    const t = await post('/api/tickets', { title: 'planned by the planner' }, 'agent').then((r) => r.json());
    expect((await post(`/api/tickets/${t.key}/promote`, undefined, 'agent')).status).toBe(404);
  });

  test('the statuses an agent may not create in are all of them but planning', async () => {
    for (const status of TICKET_STATUSES.filter((s) => s !== 'planning')) {
      const res = await post('/api/tickets', { title: 'nope', status }, 'agent');
      expect([status, res.status]).toEqual([status, 422]);
    }
  });
});
