import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './harness';
import { event } from '../src/schema';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const DESIGN = '# Shape\n\n- a slice\n- another\n';

describe('designs', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const create = (path: string, body: unknown) => req(path, json('POST', body)).then((r) => r.json());
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  /** The window is wall-clock, so a test that wants a *closed* session ages the row it would amend. */
  const backdateEvents = (minutes: number) =>
    h.db.update(event).set({ at: new Date(Date.now() - minutes * 60_000).toISOString() });

  test('a project carries a Project Design; writing, rewriting and clearing it all read back through the API', async () => {
    const project = await create('/api/projects', { name: 'MVP' });
    expect(project.design).toBeNull();

    const written = await req(`/api/projects/${project.id}`, json('PATCH', { design: DESIGN })).then((r) => r.json());
    expect(written.design).toBe(DESIGN);
    expect((await req(`/api/projects/${project.id}`).then((r) => r.json())).design).toBe(DESIGN);

    // an emptied editor is "no design", not a design that happens to be blank
    const cleared = await req(`/api/projects/${project.id}`, json('PATCH', { design: '   \n' })).then((r) => r.json());
    expect(cleared.design).toBeNull();
  });

  test('a project created with a design records it, and a design edit records both bodies', async () => {
    const project = await create('/api/projects', { name: 'MVP', design: DESIGN });
    expect(project.design).toBe(DESIGN);

    await backdateEvents(30);
    await req(`/api/projects/${project.id}`, json('PATCH', { design: `${DESIGN}\n- a third\n` }));
    const events = await req(`/api/projects/${project.id}/events`).then((r) => r.json());
    expect(events[0]).toMatchObject({ kind: 'updated', prior: { design: DESIGN }, new: { design: `${DESIGN}\n- a third\n` } });
    expect(events[1]).toMatchObject({ kind: 'created', new: expect.objectContaining({ design: DESIGN }) });
  });

  test('a ticket design normalises a blank body to no design, and the approve guard reads it', async () => {
    const app = await create('/api/apps', { name: 'Subway Reader' });
    const ticket = await create('/api/tickets', { title: 'Slice', app_id: app.id, status: 'planning' });

    const blank = await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: '\n\n' })).then((r) => r.json());
    expect(blank.design).toBeNull();
    const refused = await req(`/api/tickets/${ticket.key}/approve`, json('POST'));
    expect(refused.status).toBe(409);
    expect((await refused.json()).hint).toBe('approve needs a ticket design');

    await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: DESIGN }));
    expect((await req(`/api/tickets/${ticket.key}/approve`, json('POST'))).status).toBe(200);
  });
});

describe('an updated event is an edit session (ADR-0008)', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const create = (path: string, body: unknown) => req(path, json('POST', body)).then((r) => r.json());
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const backdateEvents = (minutes: number) =>
    h.db.update(event).set({ at: new Date(Date.now() - minutes * 60_000).toISOString() });

  test('a sitting of writing is one history line holding the text it started from', async () => {
    const ticket = await create('/api/tickets', { title: 'Slice' });
    for (const design of ['# a', '# ab', '# abc']) await req(`/api/tickets/${ticket.key}`, json('PATCH', { design }));

    const rows = await events(ticket.key);
    expect(rows.filter((e: { kind: string }) => e.kind === 'updated')).toEqual([
      expect.objectContaining({ prior: { design: null }, new: { design: '# abc' } }),
    ]);
  });

  test('a second field touched in the same sitting joins the same line', async () => {
    const ticket = await create('/api/tickets', { title: 'Slice' });
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { title: 'Slice one' }));
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { description: 'why' }));

    const rows = await events(ticket.key);
    expect(rows.filter((e: { kind: string }) => e.kind === 'updated')).toEqual([
      expect.objectContaining({ prior: { title: 'Slice', description: '' }, new: { title: 'Slice one', description: 'why' } }),
    ]);
  });

  test('an agent writing over a human edit is its own line, and so is a sitting picked up again later', async () => {
    const ticket = await create('/api/tickets', { title: 'Slice' });
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: '# human' }));
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: '# agent' }, { 'x-goblin-actor': 'agent' }));

    let updated = (await events(ticket.key)).filter((e: { kind: string }) => e.kind === 'updated');
    expect(updated).toEqual([
      expect.objectContaining({ actor: 'agent', prior: { design: '# human' }, new: { design: '# agent' } }),
      expect.objectContaining({ actor: 'human', prior: { design: null }, new: { design: '# human' } }),
    ]);

    await backdateEvents(30);
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: '# later' }, { 'x-goblin-actor': 'agent' }));
    updated = (await events(ticket.key)).filter((e: { kind: string }) => e.kind === 'updated');
    expect(updated).toHaveLength(3);
    expect(updated[0]).toMatchObject({ actor: 'agent', prior: { design: '# agent' }, new: { design: '# later' } });
  });

  test('history reads newest first by the time of the last write, not by the id of the row', async () => {
    const ticket = await create('/api/tickets', { title: 'Slice' });
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: '# one' }));
    await req(`/api/tickets/${ticket.key}/pick`, json('POST'));
    await new Promise((r) => setTimeout(r, 5));
    await req(`/api/tickets/${ticket.key}`, json('PATCH', { design: '# two' }));

    const rows = await events(ticket.key);
    expect(rows.map((e: { kind: string }) => e.kind)).toEqual(['updated', 'transitioned', 'created']);
    // the sitting was amended in place, so reading by id would put the transition on top of it
    expect(rows[0].id).toBeLessThan(rows[1].id);
  });
});
