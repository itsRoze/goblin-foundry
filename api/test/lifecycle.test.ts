import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Archive, unarchive, trash and restore write the row and its history
 * together, pinned to the row that was read (ADR-0010), for Apps and Projects
 * alike. A cascade is one batch over the parent and everything it takes or
 * brings back.
 */
describe('the App and Project lifecycle commits the row with its history or not at all', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const create = (path: string, body: unknown) => req(path, json('POST', body)).then((r) => r.json());
  const trash = () => req('/api/trash').then((r) => r.json());
  const events = (path: string) => req(`${path}/events`).then((r) => r.json());
  /** What a reader sees of one entity: the live read (or its 404), the trash, and its history. */
  const snapshot = async (path: string) => [await req(path).then((r) => r.json()), await trash(), await events(path)];

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  describe.each([
    ['apps', 'app'],
    ['projects', 'project'],
  ] as const)('/api/%s', (noun, kind) => {
    const make = () => create(`/api/${noun}`, { name: 'Thing' });

    test.each([
      ['archive', 'archived', (row: { id: number }) => req(`/api/${noun}/${row.id}/archive`, json('POST'))],
      ['unarchive', 'unarchived', (row: { id: number }) => req(`/api/${noun}/${row.id}/unarchive`, json('POST'))],
      ['trash', 'trashed', (row: { id: number }) => req(`/api/${noun}/${row.id}`, { method: 'DELETE' })],
      ['restore', 'restored', (row: { id: number }) => req(`/api/${noun}/${row.id}/restore`, json('POST'))],
    ])('%s: a history write that fails leaves the row as it was, and the same move goes through once the fault is gone', async (doing, kindOfEvent, move) => {
      const row = await make();
      if (doing === 'unarchive') await req(`/api/${noun}/${row.id}/archive`, json('POST'));
      if (doing === 'restore') await req(`/api/${noun}/${row.id}`, { method: 'DELETE' });
      const before = await snapshot(`/api/${noun}/${row.id}`);
      h.failWrites(`${kind} event`, row.id);
      const res = await move(row);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      expect((await res.json()).detail).toBe(`nothing changed — the ${kind} was not ${kindOfEvent} (${kindOfEvent} event for ${kind} ${row.id}: injected fault)`);
      expect(await snapshot(`/api/${noun}/${row.id}`)).toEqual(before);
      h.healWrites();
      expect((await move(row)).status).toBe(200);
      expect((await events(`/api/${noun}/${row.id}`))[0].kind).toBe(kindOfEvent);
    });

    test.each([
      ['archive', (row: { id: number }) => req(`/api/${noun}/${row.id}/archive`, json('POST'))],
      ['unarchive', (row: { id: number }) => req(`/api/${noun}/${row.id}/unarchive`, json('POST'))],
      ['trash', (row: { id: number }) => req(`/api/${noun}/${row.id}`, { method: 'DELETE' })],
      ['restore', (row: { id: number }) => req(`/api/${noun}/${row.id}/restore`, json('POST'))],
    ])('%s: a row that changed between the read and the write is a 409 naming it, and nothing is written', async (doing, move) => {
      const row = await make();
      if (doing === 'unarchive') await req(`/api/${noun}/${row.id}/archive`, json('POST'));
      if (doing === 'restore') await req(`/api/${noun}/${row.id}`, { method: 'DELETE' });
      const before = await snapshot(`/api/${noun}/${row.id}`);
      h.failWrites(kind, row.id, 'vanish');
      const res = await move(row);
      expect([res.status, (await res.json()).hint]).toEqual([409, `nothing changed — ${kind} ${row.id} changed while ${doing} was being applied; try again`]);
      h.healWrites();
      expect(await snapshot(`/api/${noun}/${row.id}`)).toEqual(before);
    });
  });

  describe('a cascade is one batch over the parent and every child it takes or brings back', () => {
    /** An App with two Projects holding tickets and one loose ticket: the shape every cascade below runs over. */
    async function household() {
      const app = await create('/api/apps', { name: 'A' });
      const p = await create('/api/projects', { name: 'P', app_id: app.id });
      const q = await create('/api/projects', { name: 'Q', app_id: app.id });
      const inP = await create('/api/tickets', { title: 'in p', project_id: p.id });
      const inQ = await create('/api/tickets', { title: 'in q', project_id: q.id });
      const loose = await create('/api/tickets', { title: 'loose', app_id: app.id });
      const paths = [`/api/apps/${app.id}`, `/api/projects/${p.id}`, `/api/projects/${q.id}`, `/api/tickets/${inP.key}`, `/api/tickets/${inQ.key}`, `/api/tickets/${loose.key}`];
      const everything = async () => {
        const out = [];
        for (const path of paths) out.push(await snapshot(path));
        return out;
      };
      return { app, p, q, inP, inQ, loose, everything };
    }

    test('a trash cascade whose last history write fails leaves every row live and every history untouched, and goes through once the fault is gone', async () => {
      const { app, loose, everything } = await household();
      const before = await everything();
      // both projects, their tickets, and the app's own row have all run by the time the loose ticket's history fails
      h.failWrites('ticket event', loose.id);
      const res = await req(`/api/apps/${app.id}?cascade=1`, { method: 'DELETE' });
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe(`nothing changed — the app was not trashed (trashed event for ticket ${loose.id}: injected fault)`);
      expect(await everything()).toEqual(before);
      expect(await trash()).toEqual({ apps: [], projects: [], tickets: [] });
      h.healWrites();
      expect((await req(`/api/apps/${app.id}?cascade=1`, { method: 'DELETE' })).status).toBe(200);
      const after = await trash();
      expect([after.apps.length, after.projects.length, after.tickets.length]).toEqual([1, 2, 3]);
    });

    test('a restore cascade whose history write fails leaves everything in the trash', async () => {
      const { app, inQ, everything } = await household();
      await req(`/api/apps/${app.id}?cascade=1`, { method: 'DELETE' });
      const before = await everything();
      h.failWrites('ticket event', inQ.id);
      const res = await req(`/api/apps/${app.id}/restore`, json('POST'));
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe(`nothing changed — the app was not restored (restored event for ticket ${inQ.id}: injected fault)`);
      expect(await everything()).toEqual(before);
      h.healWrites();
      expect((await req(`/api/apps/${app.id}/restore`, json('POST'))).status).toBe(200);
      expect(await trash()).toEqual({ apps: [], projects: [], tickets: [] });
    });

    test('a detaching trash whose history write fails for one ticket leaves every project and ticket where it was', async () => {
      const { app, p, inP, everything } = await household();
      const before = await everything();
      h.failWrites('ticket event', inP.id);
      const res = await req(`/api/apps/${app.id}`, { method: 'DELETE' });
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe(`nothing changed — the app was not trashed (updated event for ticket ${inP.id}: injected fault)`);
      expect(await everything()).toEqual(before);
      expect((await req(`/api/projects/${p.id}`).then((r) => r.json())).app_id).toBe(app.id);
    });

    test('a project cascade whose history write fails leaves the project and its tickets live', async () => {
      const { p, inP, everything } = await household();
      const before = await everything();
      h.failWrites('ticket event', inP.id);
      const res = await req(`/api/projects/${p.id}?cascade=1`, { method: 'DELETE' });
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe(`nothing changed — the project was not trashed (trashed event for ticket ${inP.id}: injected fault)`);
      expect(await everything()).toEqual(before);
    });

    test('a ticket that moved between the read and the cascade is a 409 naming its key, and nothing is trashed', async () => {
      const { app, inQ, everything } = await household();
      const before = await everything();
      h.failWrites('ticket', inQ.id, 'vanish');
      const res = await req(`/api/apps/${app.id}?cascade=1`, { method: 'DELETE' });
      expect([res.status, (await res.json()).hint]).toEqual([409, `nothing changed — ticket ${inQ.key} changed while trash was being applied; try again`]);
      h.healWrites();
      expect(await everything()).toEqual(before);
    });

    test('a project restore that would come back app-less fails as a whole when its history write fails, and goes through once it is gone', async () => {
      const { app, p, inP, everything } = await household();
      await req(`/api/apps/${app.id}?cascade=1`, { method: 'DELETE' });
      const before = await everything();
      h.failWrites('project event', p.id);
      const res = await req(`/api/projects/${p.id}/restore`, json('POST'));
      expect(res.status).toBe(500);
      expect((await res.json()).detail).toBe(`nothing changed — the project was not restored (restored event for project ${p.id}: injected fault)`);
      expect(await everything()).toEqual(before);
      h.healWrites();
      const restored = await req(`/api/projects/${p.id}/restore`, json('POST')).then((r) => r.json());
      expect(restored).toMatchObject({ id: p.id, trashed_at: null, app_id: null });
      // the ticket the cascade took comes back with it, and follows it out of the app (ADR-0007)
      expect(await req(`/api/tickets/${inP.key}`).then((r) => r.json())).toMatchObject({ trashed_at: null, project_id: p.id, app_id: null });
      expect((await events(`/api/projects/${p.id}`)).map((e: { kind: string }) => e.kind)).toEqual(['restored', 'updated', 'trashed', 'created']);
      expect((await events(`/api/tickets/${inP.key}`)).map((e: { kind: string }) => e.kind)).toEqual(['updated', 'restored', 'trashed', 'created']);
    });
  });
});
