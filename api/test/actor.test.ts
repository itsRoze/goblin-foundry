import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lifecycle, type TicketStatus, type TransitionName } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, actor?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(actor ? { 'X-Goblin-Actor': actor } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/**
 * GLOSSARY.md "Actor": a record, never a permission (ADR-0012). Either Actor
 * creates anywhere the lifecycle allows and makes every move; history says
 * whose hands made each one.
 */
describe('either Actor makes every move, and history records which', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown, actor?: string) => req(path, json('POST', body, actor));
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const newApp = () => post('/api/apps', { name: `app-${Math.random()}` }).then((r) => r.json());

  /** The terminal statuses are earned, so the agent walks there from one it may create in. */
  const EARNED: Partial<Record<TicketStatus, [TicketStatus, TransitionName]>> = { done: ['review', 'ship'], cancelled: ['backlog', 'cancel'] };

  /** A ticket the agent put in `status`, simple and housed so the approve guard never speaks. */
  const agentAt = async (status: TicketStatus) => {
    const app = await newApp();
    const [born, move] = EARNED[status] ?? [status];
    const t = await post('/api/tickets', { title: `a ticket for ${status}`, status: born, app_id: app.id, simple: true }, 'agent').then((r) => r.json());
    return move ? post(`/api/tickets/${t.key}/${move}`, undefined, 'agent').then((r) => r.json()) : t;
  };

  test('a create with no status lands in backlog, whoever makes it, and records who did', async () => {
    for (const actor of ['human', 'agent']) {
      const res = await post('/api/tickets', { title: `an idea of the ${actor}'s` }, actor);
      expect([actor, res.status]).toEqual([actor, 201]);
      const created = await res.json();
      expect([actor, created.status]).toEqual([actor, 'backlog']);
      expect((await events(created.key))[0]).toMatchObject({ kind: 'created', actor, new: { status: 'backlog' } });
    }
  });

  test('an agent creates in every creatable status, the guard permitting', async () => {
    const app = await newApp();
    for (const status of ['backlog', 'todo', 'planning', 'ready', 'building', 'review'] as const) {
      const res = await post('/api/tickets', { title: `born in ${status}`, status, app_id: app.id, simple: true }, 'agent');
      expect([status, res.status]).toEqual([status, 201]);
      expect([status, (await res.json()).status]).toEqual([status, status]);
    }
  });

  test('the guard still holds an agent at ready, as it holds a human', async () => {
    for (const actor of ['human', 'agent']) {
      const res = await post('/api/tickets', { title: 'no app, no design', status: 'ready' }, actor);
      expect([actor, res.status]).toEqual([actor, 422]);
      expect([actor, (await res.json()).issues]).toEqual([actor, [{ path: ['status'], message: 'a ticket in ready needs an app and a ticket design' }]]);
    }
  });

  test('done and cancelled stay earned, for either Actor', async () => {
    const app = await newApp();
    for (const actor of ['human', 'agent'])
      for (const status of ['done', 'cancelled']) {
        const res = await post('/api/tickets', { title: 'nope', status, app_id: app.id, simple: true }, actor);
        expect([actor, status, res.status]).toEqual([actor, status, 422]);
        expect([actor, status, (await res.json()).issues]).toEqual([actor, status, [{ path: ['status'], message: `a ticket is never created in ${status} — it is earned, not declared` }]]);
      }
  });

  test('an agent makes every transition in the table, and each event records the agent and the name', async () => {
    for (const { from, name, to } of lifecycle.edges) {
      const t = await agentAt(from);
      expect([from, name, t.status]).toEqual([from, name, from]);
      const res = await post(`/api/tickets/${t.key}/${name}`, undefined, 'agent');
      expect([from, name, res.status]).toEqual([from, name, 200]);
      expect([from, name, (await res.json()).status]).toEqual([from, name, to]);
      expect((await events(t.key))[0]).toMatchObject({ kind: 'transitioned', actor: 'agent', prior: { status: from }, new: { status: to, transition: name } });
    }
  });

  test('a human makes the same moves, recorded as the human', async () => {
    const t = await agentAt('planning');
    for (const name of ['approve', 'start', 'submit', 'ship'] as const) expect([name, (await post(`/api/tickets/${t.key}/${name}`)).status]).toEqual([name, 200]);
    const history = (await events(t.key)).filter((e: { kind: string }) => e.kind === 'transitioned');
    expect(history.map((e: { actor: string; new: { transition: string } }) => `${e.actor} ${e.new.transition}`)).toEqual(['human ship', 'human submit', 'human start', 'human approve']);
  });

  test('an agent moves a batch, every member recorded as the agent', async () => {
    const a = await agentAt('todo');
    const b = await agentAt('planning');
    const res = await post('/api/tickets/bulk', { tickets: [a.key, b.key], action: { kind: 'transition', name: 'approve' } }, 'agent');
    expect(res.status).toBe(200);
    for (const key of [a.key, b.key]) expect((await events(key))[0]).toMatchObject({ kind: 'transitioned', actor: 'agent', new: { status: 'ready', transition: 'approve' } });
  });

  test('what refuses an agent is what refuses a human: no arrow, or the guard', async () => {
    const t = await post('/api/tickets', { title: 'no app, no design', status: 'planning' }, 'agent').then((r) => r.json());
    for (const actor of [undefined, 'agent']) {
      expect([actor, (await post(`/api/tickets/${t.key}/ship`, undefined, actor).then((r) => r.json())).hint]).toEqual([actor, 'a ticket in planning does not go to done']);
      expect([actor, (await post(`/api/tickets/${t.key}/approve`, undefined, actor).then((r) => r.json())).hint]).toEqual([actor, 'approve needs an app and a ticket design']);
    }
  });

  test('an unknown verb is a 404 for an agent as for anyone', async () => {
    const t = await agentAt('planning');
    expect((await post(`/api/tickets/${t.key}/promote`, undefined, 'agent')).status).toBe(404);
  });
});
