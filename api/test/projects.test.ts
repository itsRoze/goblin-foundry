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

  /**
   * Tickets have no API until issue 03, so they are stubbed straight into the
   * table and their homes read back the same way. Issue 03 moves these reads
   * to `/api/tickets/:key` and its `/events` (spec: behaviour through the seam).
   */
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
    expect(events).toEqual([expect.objectContaining({ entity_kind: 'project', entity_id: mvp.id, kind: 'created', prior: null, new: { name: 'MVP', description: 'first cut', design: null, app_id: app.id } })]);
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
    await stubTicket('two', null, p.id);
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

    const pEvents = await req(`/api/projects/${p.id}/events`).then((r) => r.json());
    expect(pEvents.map((e: { kind: string; prior: unknown; new: unknown }) => [e.kind, e.prior, e.new])).toEqual([
      ['updated', { app_id: a.id }, { app_id: b.id }],
      ['updated', { app_id: null }, { app_id: a.id }],
      ['created', null, { name: 'Roaming', description: '', design: null, app_id: null }],
    ]);
  });

  test('archive hides a project, ?archived=1 reveals it, double archive is a 409', async () => {
    const p = await create('/api/projects', { name: 'Old' });
    expect((await req(`/api/projects/${p.id}/archive`, json('POST'))).status).toBe(200);
    expect(await req('/api/projects').then((r) => r.json())).toEqual([]);
    expect((await req('/api/projects?archived=1').then((r) => r.json())).map((x: { id: number }) => x.id)).toEqual([p.id]);
    const again = await req(`/api/projects/${p.id}/archive`, json('POST'));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ hint: expect.stringContaining('already archived') });
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

  describe('create and edit write the row, its tickets and the history together, against the rows that were read (ADR-0010)', () => {
    const snapshot = async (path: string) => [await req(path).then((r) => r.json()), await req(`${path}/events`).then((r) => r.json())];

    test('a history write that fails leaves no project, and the same create goes through once the fault is gone', async () => {
      const app = await create('/api/apps', { name: 'A' });
      h.failWrites('project event', 1);
      const res = await req('/api/projects', json('POST', { name: 'MVP', app_id: app.id }));
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe('nothing changed — the project was not created (created event: injected fault)');
      expect(await req('/api/projects').then((r) => r.json())).toEqual([]);
      h.healWrites();
      const created = await req('/api/projects', json('POST', { name: 'MVP', app_id: app.id }));
      expect([created.status, (await created.json()).id]).toEqual([201, 1]);
    });

    test('a history write that fails for one of the tickets a move carries leaves the project, its fields and every ticket as they were', async () => {
      const a = await create('/api/apps', { name: 'A' });
      const b = await create('/api/apps', { name: 'B' });
      const p = await create('/api/projects', { name: 'P', app_id: a.id });
      const first = await create('/api/tickets', { title: 'first', project_id: p.id });
      const last = await create('/api/tickets', { title: 'last', project_id: p.id });
      const before = [await snapshot(`/api/projects/${p.id}`), await snapshot(`/api/tickets/${first.key}`), await snapshot(`/api/tickets/${last.key}`)];
      // the project's row and event, and the first ticket's, have all run by the time the last ticket's history fails
      h.failWrites('ticket event', last.id);
      const res = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P2', app_id: b.id }));
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe(`nothing changed — the edit was rolled back (updated event for ticket ${last.id}: injected fault)`);
      expect([await snapshot(`/api/projects/${p.id}`), await snapshot(`/api/tickets/${first.key}`), await snapshot(`/api/tickets/${last.key}`)]).toEqual(before);
      h.healWrites();
      const moved = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P2', app_id: b.id })).then((r) => r.json());
      expect(moved).toMatchObject({ name: 'P2', app_id: b.id });
      expect((await ticketHomes()).map((t) => t.app_id)).toEqual([b.id, b.id]);
    });

    test('an app that went into the trash between the judging and the write is a 409 naming it, on create, on a move and on restore', async () => {
      const a = await create('/api/apps', { name: 'A' });
      const p = await create('/api/projects', { name: 'P' });
      const before = await snapshot(`/api/projects/${p.id}`);
      h.failWrites('app', a.id, 'vanish');
      const created = await req('/api/projects', json('POST', { name: 'Q', app_id: a.id }));
      expect([created.status, (await created.json()).hint]).toEqual([409, `nothing changed — app ${a.id} changed while create was being applied; try again`]);
      const moved = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P2', app_id: a.id }));
      expect([moved.status, (await moved.json()).hint]).toEqual([409, `nothing changed — app ${a.id} changed while the edit was being applied; try again`]);
      h.healWrites();
      expect(await req('/api/projects').then((r) => r.json())).toHaveLength(1);
      expect(await snapshot(`/api/projects/${p.id}`)).toEqual(before);

      expect((await req(`/api/projects/${p.id}`, json('PATCH', { app_id: a.id }))).status).toBe(200);
      await req(`/api/projects/${p.id}`, { method: 'DELETE' });
      h.failWrites('app', a.id, 'vanish');
      const restored = await req(`/api/projects/${p.id}/restore`, json('POST'));
      expect([restored.status, (await restored.json()).hint]).toEqual([409, `nothing changed — app ${a.id} changed while restore was being applied; try again`]);
      h.healWrites();
      expect((await req('/api/trash').then((r) => r.json())).projects.map((x: { id: number }) => x.id)).toEqual([p.id]);
    });

    test('a project that changed between the read and the edit is a 409 naming it, and nothing is written', async () => {
      const p = await create('/api/projects', { name: 'P' });
      const before = await snapshot(`/api/projects/${p.id}`);
      h.failWrites('project', p.id, 'vanish');
      const res = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P2' }));
      expect([res.status, (await res.json()).hint]).toEqual([409, `nothing changed — project ${p.id} changed while the edit was being applied; try again`]);
      h.healWrites();
      expect(await snapshot(`/api/projects/${p.id}`)).toEqual(before);
    });

    test('an edit judged on an older version of the project is the same 409, and one judged on the current version goes through', async () => {
      const p = await create('/api/projects', { name: 'P' });
      await Bun.sleep(2);
      expect((await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P moved' }))).status).toBe(200);
      const before = await snapshot(`/api/projects/${p.id}`);
      const late = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P late' }, { 'x-goblin-updated-at': p.updated_at }));
      expect([late.status, (await late.json()).hint]).toEqual([409, `nothing changed — project ${p.id} changed while the edit was being applied; try again`]);
      expect(await snapshot(`/api/projects/${p.id}`)).toEqual(before);
      const { updated_at } = await req(`/api/projects/${p.id}`).then((r) => r.json());
      const current = await req(`/api/projects/${p.id}`, json('PATCH', { name: 'P late' }, { 'x-goblin-updated-at': updated_at }));
      expect([current.status, (await current.json()).name]).toEqual([200, 'P late']);
    });
  });
});
