import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TICKET_STATUSES, type Actor, type TicketStatus, type TransitionName } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, actor?: Actor) => ({
  method,
  headers: { 'content-type': 'application/json', ...(actor ? { 'X-Goblin-Actor': actor } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('the lifecycle on the wire, pinned', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown, actor?: Actor) => req(path, json('POST', body, actor));
  const patch = (path: string, body: unknown) => req(path, json('PATCH', body));

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const ROUTE: Partial<Record<TicketStatus, TransitionName[]>> = { todo: ['pick'], planning: ['plan'], building: ['pick', 'approve', 'start'] };

  const at = async (status: TicketStatus, designed = true) => {
    const app = await post('/api/apps', { name: `app-${Math.random()}` }).then((r) => r.json());
    const t = await post('/api/tickets', { title: `a ticket for ${status}`, app_id: app.id }).then((r) => r.json());
    if (designed) await patch(`/api/tickets/${t.key}`, { design: 'the plan' });
    for (const name of ROUTE[status] ?? []) expect([(await post(`/api/tickets/${t.key}/${name}`)).status, name]).toEqual([200, name]);
    return req(`/api/tickets/${t.key}`).then((r) => r.json());
  };

  test('creation: every actor at every status, with nothing, with an app, and simple with an app', async () => {
    const app = await post('/api/apps', { name: 'Reader' }).then((r) => r.json());
    const bodies = { bare: {}, housed: { app_id: app.id }, simple: { app_id: app.id, simple: true } };
    const lines: string[] = [];
    for (const actor of ['human', 'agent'] as const)
      for (const status of TICKET_STATUSES)
        for (const [fixture, body] of Object.entries(bodies)) {
          const res = await post('/api/tickets', { title: 'born here', status, ...body }, actor);
          const answer = await res.json();
          const said = res.status === 201 ? answer.status : answer.issues.map((i: { path: string[]; message: string }) => `${i.path.join('.')}: ${i.message}`).join(' · ');
          lines.push(`${actor} ${status} ${fixture}: ${res.status} ${said}`);
        }
    expect(lines).toMatchSnapshot();
  });

  test('a refused move answers 409 with the sentence and its owner: no arrow, not yet', async () => {
    const review = await at('building').then((t) => post(`/api/tickets/${t.key}/submit`, undefined, 'agent').then((r) => r.json()));
    expect(review.status).toBe('review');
    const noArrow = await post(`/api/tickets/${review.key}/start`);
    expect([noArrow.status, await noArrow.json()]).toEqual([409, { type: 'about:blank', title: 'Conflict', status: 409, owner: 'human', hint: 'a ticket in review does not go back to building' }]);

    const bare = await post('/api/tickets', { title: 'nothing on it', status: 'todo' }).then((r) => r.json());
    const notYet = await post(`/api/tickets/${bare.key}/approve`);
    expect([notYet.status, await notYet.json()]).toEqual([409, { type: 'about:blank', title: 'Conflict', status: 409, owner: 'human', hint: 'approve needs an app and a ticket design' }]);
  });

  test("a batch refused for no arrow and then for the guard is the human's 409", async () => {
    const building = await at('building');
    const undesigned = await at('todo', false);
    const res = await post('/api/tickets/bulk', { tickets: [building.key, undesigned.key], action: { kind: 'transition', name: 'approve' } });
    expect([res.status, await res.json()]).toEqual([
      409,
      {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        owner: 'human',
        hint: `nothing changed — ${building.key}: a ticket in building does not go back to ready · ${undesigned.key}: approve needs a ticket design`,
        refusals: [
          { key: building.key, reason: 'a ticket in building does not go back to ready' },
          { key: undesigned.key, reason: 'approve needs a ticket design' },
        ],
      },
    ]);
  });
});
