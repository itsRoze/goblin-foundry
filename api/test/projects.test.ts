import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, asc, eq } from 'drizzle-orm';
import { makeTestApp } from './harness';
import { event, ticket } from '../src/schema';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('/api/projects', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const create = (path: string, body: unknown) => req(path, json('POST', body)).then((r) => r.json());
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  /** Tickets cannot be created through the API until issue 03; stub them straight into the table. */
  async function stubTicket(title: string, app_id: number | null, project_id: number | null) {
    const at = new Date().toISOString();
    const [row] = await h.db.insert(ticket).values({ title, app_id, project_id, created_at: at, updated_at: at }).returning();
    return row!;
  }
  const ticketHomes = async () =>
    (await h.db.select({ title: ticket.title, app_id: ticket.app_id, project_id: ticket.project_id, trashed_at: ticket.trashed_at }).from(ticket).orderBy(asc(ticket.id)));

  test('creates a project inside an app and one with no app yet; the list groups by app_id and can filter by it', async () => {
    const app = await create('/api/apps', { name: 'Subway Reader' });
    const res = await req('/api/projects', json('POST', { name: 'MVP', description: 'first cut', app_id: app.id }));
    expect(res.status).toBe(201);
    const mvp = await res.json();
    expect(mvp).toMatchObject({ id: 1, app_id: app.id, name: 'MVP', description: 'first cut', archived_at: null, trashed_at: null });

    const orphan = await create('/api/projects', { name: 'Someday' });
    expect(orphan.app_id).toBeNull();

    expect(await req('/api/projects').then((r) => r.json())).toEqual([mvp, orphan]);
    expect(await req(`/api/projects?app_id=${app.id}`).then((r) => r.json())).toEqual([mvp]);
    expect(await req('/api/projects?app_id=null').then((r) => r.json())).toEqual([orphan]);

    const events = await req(`/api/projects/${mvp.id}/events`).then((r) => r.json());
    expect(events).toEqual([expect.objectContaining({ entity_kind: 'project', entity_id: mvp.id, kind: 'created', prior: null, new: { name: 'MVP', description: 'first cut', app_id: app.id } })]);
  });

  test('a project cannot point at an app that does not exist or is trashed', async () => {
    const res = await req('/api/projects', json('POST', { name: 'X', app_id: 42 }));
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: ['app_id'], message: 'app 42 not found' }]);

    const app = await create('/api/apps', { name: 'Gone' });
    await req(`/api/apps/${app.id}`, { method: 'DELETE' });
    expect((await req('/api/projects', json('POST', { name: 'X', app_id: app.id }))).status).toBe(422);
  });

  test('renames a project; a body with archived_at is refused; an unknown id is a 404', async () => {
    const p = await create('/api/projects', { name: 'MPV' });
    const res = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'MVP' }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('MVP');
    expect((await req(`/api/projects/${p.id}`, json('PATCH', { archived_at: null }))).status).toBe(422);
    expect((await req('/api/projects/77')).status).toBe(404);
    expect(await req('/api/projects/77').then((r) => r.json())).toMatchObject({ status: 404, detail: 'project 77 not found' });
  });

  test('attaching an orphan project and moving it between apps carries its tickets (ADR-0007), one updated event per ticket', async () => {
    const a = await create('/api/apps', { name: 'A' });
    const b = await create('/api/apps', { name: 'B' });
    const p = await create('/api/projects', { name: 'Roaming' });
    const t1 = await stubTicket('one', null, p.id);
    const t2 = await stubTicket('two', null, p.id);
    await stubTicket('elsewhere', a.id, null);

    const attached = await req(`/api/projects/${p.id}`, json('PATCH', { app_id: a.id })).then((r) => r.json());
    expect(attached.app_id).toBe(a.id);
    expect(await ticketHomes()).toEqual([
      { title: 'one', app_id: a.id, project_id: p.id, trashed_at: null },
      { title: 'two', app_id: a.id, project_id: p.id, trashed_at: null },
      { title: 'elsewhere', app_id: a.id, project_id: null, trashed_at: null },
    ]);

    const moved = await req(`/api/projects/${p.id}`, json('PATCH', { app_id: b.id }, { 'X-Goblin-Actor': 'agent' })).then((r) => r.json());
    expect(moved.app_id).toBe(b.id);
    expect((await ticketHomes()).map((t) => t.app_id)).toEqual([b.id, b.id, a.id]);

    const t1Events = await h.db.select().from(event).where(and(eq(event.entity_kind, 'ticket'), eq(event.entity_id, t1.id)));
    expect(t1Events.map((e) => [e.entity_kind, e.kind, e.actor, e.prior, e.new])).toEqual([
      ['ticket', 'updated', 'human', { app_id: null }, { app_id: a.id }],
      ['ticket', 'updated', 'agent', { app_id: a.id }, { app_id: b.id }],
    ]);
    expect(t2.id).not.toBe(t1.id);

    const pEvents = await req(`/api/projects/${p.id}/events`).then((r) => r.json());
    expect(pEvents.map((e: { kind: string; prior: unknown; new: unknown }) => [e.kind, e.prior, e.new])).toEqual([
      ['updated', { app_id: a.id }, { app_id: b.id }],
      ['updated', { app_id: null }, { app_id: a.id }],
      ['created', null, { name: 'Roaming', description: '', app_id: null }],
    ]);
  });

  test('archive hides a project, ?archived=1 reveals it, double archive is a 409', async () => {
    const p = await create('/api/projects', { name: 'Old' });
    expect((await req(`/api/projects/${p.id}/archive`, json('POST'))).status).toBe(200);
    expect(await req('/api/projects').then((r) => r.json())).toEqual([]);
    expect((await req('/api/projects?archived=1').then((r) => r.json())).map((x: { id: number }) => x.id)).toEqual([p.id]);
    const again = await req(`/api/projects/${p.id}/archive`, json('POST'));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ owner: 'human', hint: expect.stringContaining('already archived') });
    expect((await req(`/api/projects/${p.id}/unarchive`, json('POST'))).status).toBe(200);
  });

  test('trashing an app detaches its projects and project-less tickets; restore does not re-attach', async () => {
    const a = await create('/api/apps', { name: 'A' });
    const p = await create('/api/projects', { name: 'P', app_id: a.id });
    await stubTicket('in project', a.id, p.id);
    await stubTicket('loose', a.id, null);

    expect((await req(`/api/apps/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    const orphan = await req(`/api/projects/${p.id}`).then((r) => r.json());
    expect(orphan.app_id).toBeNull();
    expect(await ticketHomes()).toEqual([
      { title: 'in project', app_id: null, project_id: p.id, trashed_at: null },
      { title: 'loose', app_id: null, project_id: null, trashed_at: null },
    ]);
    const pEvents = await req(`/api/projects/${p.id}/events`).then((r) => r.json());
    expect(pEvents[0]).toMatchObject({ kind: 'updated', prior: { app_id: a.id }, new: { app_id: null } });

    await req(`/api/apps/${a.id}/restore`, json('POST'));
    expect((await req(`/api/projects/${p.id}`).then((r) => r.json())).app_id).toBeNull();
    expect((await ticketHomes()).map((t) => t.app_id)).toEqual([null, null]);
  });

  test('trashing a project detaches its tickets (app kept)', async () => {
    const a = await create('/api/apps', { name: 'A' });
    const p = await create('/api/projects', { name: 'P', app_id: a.id });
    await stubTicket('t', a.id, p.id);
    await req(`/api/projects/${p.id}`, { method: 'DELETE' });
    expect(await ticketHomes()).toEqual([{ title: 't', app_id: a.id, project_id: null, trashed_at: null }]);
    expect((await req(`/api/projects/${p.id}`)).status).toBe(404);
    expect((await req('/api/trash').then((r) => r.json())).projects).toEqual([expect.objectContaining({ id: p.id, trashed_at: expect.any(String) })]);
  });

  test('?cascade=1 trashes the children too, and restoring the parent revives exactly those', async () => {
    const a = await create('/api/apps', { name: 'A' });
    const p = await create('/api/projects', { name: 'P', app_id: a.id });
    const q = await create('/api/projects', { name: 'Q', app_id: a.id });
    await stubTicket('in p', a.id, p.id);
    await stubTicket('loose', a.id, null);
    // trashed on its own beforehand — the app's restore must leave it in the trash
    await req(`/api/projects/${q.id}`, { method: 'DELETE' });

    await req(`/api/apps/${a.id}?cascade=1`, { method: 'DELETE' });
    expect((await req(`/api/projects/${p.id}`)).status).toBe(404);
    expect((await ticketHomes()).map((t) => [t.title, t.trashed_at !== null, t.app_id, t.project_id])).toEqual([
      ['in p', true, a.id, p.id],
      ['loose', true, a.id, null],
    ]);
    const trash = await req('/api/trash').then((r) => r.json());
    expect(trash.projects.map((x: { id: number }) => x.id).sort()).toEqual([p.id, q.id].sort());

    await req(`/api/apps/${a.id}/restore`, json('POST'));
    const revived = await req(`/api/projects/${p.id}`).then((r) => r.json());
    expect(revived).toMatchObject({ app_id: a.id, trashed_at: null });
    expect((await req(`/api/projects/${q.id}`)).status).toBe(404);
    expect((await ticketHomes()).map((t) => [t.title, t.trashed_at, t.app_id, t.project_id])).toEqual([
      ['in p', null, a.id, p.id],
      ['loose', null, a.id, null],
    ]);
  });

  test('restoring a project whose app is still trashed leaves it app-less', async () => {
    const a = await create('/api/apps', { name: 'A' });
    const p = await create('/api/projects', { name: 'P', app_id: a.id });
    await req(`/api/apps/${a.id}?cascade=1`, { method: 'DELETE' });
    const restored = await req(`/api/projects/${p.id}/restore`, json('POST')).then((r) => r.json());
    expect(restored).toMatchObject({ trashed_at: null, app_id: null });
    expect((await req(`/api/projects/${p.id}/restore`, json('POST'))).status).toBe(409);
  });
});
