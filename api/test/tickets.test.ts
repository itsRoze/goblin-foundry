import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('/api/tickets', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown, headers?: Record<string, string>) => req(path, json('POST', body, headers));
  const newTicket = (body: Record<string, unknown>) => post('/api/tickets', body).then((r) => r.json());
  const newApp = (name: string) => post('/api/apps', { name }).then((r) => r.json());
  const newProject = (name: string, app_id?: number) => post('/api/projects', { name, app_id: app_id ?? null }).then((r) => r.json());
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  test('a title alone makes a ticket: key GF-1, backlog, no app or project, and a created event carrying the status', async () => {
    const res = await post('/api/tickets', { title: '  Article list screen  ' });
    expect(res.status).toBe(201);
    const t = await res.json();
    expect(t).toMatchObject({
      id: 1,
      key: 'GF-1',
      title: 'Article list screen',
      description: '',
      status: 'backlog',
      simple: false,
      design: null,
      app_id: null,
      project_id: null,
      trashed_at: null,
    });

    expect(await events('GF-1')).toEqual([
      expect.objectContaining({
        entity_kind: 'ticket',
        entity_id: 1,
        actor: 'human',
        kind: 'created',
        prior: null,
        new: { title: 'Article list screen', description: '', status: 'backlog', simple: false, design: null, app_id: null, project_id: null },
      }),
    ]);
  });

  test('numbers are never reused: a trashed ticket does not free its key', async () => {
    const first = await newTicket({ title: 'one' });
    await req(`/api/tickets/${first.key}`, { method: 'DELETE' });
    expect((await newTicket({ title: 'two' })).key).toBe('GF-2');
  });

  // the approve guard on a ticket born at `ready` or beyond is `transitions.test.ts`'s business
  test('a status may be chosen at creation; an unknown one is refused', async () => {
    expect((await newTicket({ title: 'born planning', status: 'planning' })).status).toBe('planning');
    const bad = await post('/api/tickets', { title: 'x', status: 'needs_human' });
    expect(bad.status).toBe(422);
    expect((await bad.json()).issues[0].path).toEqual(['status']);
  });

  test('the key is lenient on the way in and canonical on the way out', async () => {
    const t = await newTicket({ title: 'lenient' });
    for (const key of ['GF-1', 'SR-1', 'gf-1', '1']) {
      const res = await req(`/api/tickets/${key}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(t);
    }
    const missing = await req('/api/tickets/GF-99');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    expect((await missing.json()).detail).toBe('ticket GF-99 not found');
  });

  test('editing changes title, description, simple and design, and records the whole description body', async () => {
    const t = await newTicket({ title: 'draft title' });
    const res = await req(`/api/tickets/${t.key}`, json('PATCH', { title: 'better title', description: 'the long body', simple: true, design: '# plan' }, { 'X-Goblin-Actor': 'agent' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: 'GF-1', title: 'better title', description: 'the long body', simple: true, design: '# plan', status: 'backlog' });

    const [latest] = await events(t.key);
    expect(latest).toMatchObject({
      kind: 'updated',
      actor: 'agent',
      prior: { title: 'draft title', description: '', simple: false, design: null },
      new: { title: 'better title', description: 'the long body', simple: true, design: '# plan' },
    });
  });

  test('status is not an editable field', async () => {
    const t = await newTicket({ title: 'x' });
    const res = await req(`/api/tickets/${t.key}`, json('PATCH', { status: 'ready' }));
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: ['status'], message: 'status moves through a transition, not an edit (ADR-0003)' }]);
    expect((await req(`/api/tickets/${t.key}`).then((r) => r.json())).status).toBe('backlog');
  });

  describe('ADR-0007: a ticket in a project has the project’s app', () => {
    test('creating in a project fills the app; a contradicting app_id is refused', async () => {
      const app = await newApp('Subway Reader');
      const other = await newApp('Other');
      const project = await newProject('MVP', app.id);

      expect(await newTicket({ title: 'in the project', project_id: project.id })).toMatchObject({ app_id: app.id, project_id: project.id });

      const clash = await post('/api/tickets', { title: 'x', project_id: project.id, app_id: other.id });
      expect(clash.status).toBe(422);
      expect((await clash.json()).issues).toEqual([{ path: ['app_id'], message: `project ${project.id} belongs to app ${app.id}` }]);
    });

    test('moving between projects keeps the key and rewrites the app; changing the app clears the project', async () => {
      const a = await newApp('A');
      const b = await newApp('B');
      const pa = await newProject('in A', a.id);
      const pb = await newProject('in B', b.id);
      const t = await newTicket({ title: 'travels', project_id: pa.id });

      const moved = await req(`/api/tickets/${t.key}`, json('PATCH', { project_id: pb.id })).then((r) => r.json());
      expect(moved).toMatchObject({ key: t.key, app_id: b.id, project_id: pb.id });

      const rehomed = await req(`/api/tickets/${t.key}`, json('PATCH', { app_id: a.id })).then((r) => r.json());
      expect(rehomed).toMatchObject({ key: t.key, app_id: a.id, project_id: null });
    });

    test('a trashed or archived parent is not somewhere a live ticket may point', async () => {
      const app = await newApp('A');
      const project = await newProject('P', app.id);
      await post(`/api/projects/${project.id}/archive`);
      const archived = await post('/api/tickets', { title: 'x', project_id: project.id });
      expect(archived.status).toBe(422);
      expect((await archived.json()).issues).toEqual([{ path: ['project_id'], message: `project ${project.id} is archived` }]);

      await req(`/api/apps/${app.id}`, { method: 'DELETE' });
      const trashed = await post('/api/tickets', { title: 'x', app_id: app.id });
      expect(trashed.status).toBe(422);
      expect((await trashed.json()).issues).toEqual([{ path: ['app_id'], message: `app ${app.id} is in the trash` }]);
    });
  });

  describe('trash', () => {
    test('a trashed ticket leaves the lists, appears in /api/trash and refuses a second trashing', async () => {
      const t = await newTicket({ title: 'mistake' });
      const trashed = await req(`/api/tickets/${t.key}`, { method: 'DELETE' });
      expect(trashed.status).toBe(200);
      expect((await trashed.json()).trashed_at).toEqual(expect.any(String));
      expect(await req('/api/tickets').then((r) => r.json())).toEqual([]);
      expect(await req(`/api/tickets/${t.key}`).then((r) => r.status)).toBe(404);

      const trash = await req('/api/trash').then((r) => r.json());
      expect(trash.tickets).toEqual([expect.objectContaining({ key: 'GF-1', title: 'mistake' })]);

      const again = await req(`/api/tickets/${t.key}`, { method: 'DELETE' });
      expect(again.status).toBe(409);
      expect((await again.json()).hint).toBe('ticket GF-1 is already in the trash');
    });

    test('restore brings it back, but never pointing at a parent that is still in the trash', async () => {
      const app = await newApp('A');
      const project = await newProject('P', app.id);
      const t = await newTicket({ title: 'orphaned by its project', project_id: project.id });

      await req(`/api/tickets/${t.key}`, { method: 'DELETE' });
      await req(`/api/projects/${project.id}?cascade=1`, { method: 'DELETE' });

      const restored = await post(`/api/tickets/${t.key}/restore`).then((r) => r.json());
      expect(restored).toMatchObject({ key: t.key, trashed_at: null, project_id: null, app_id: app.id });
      expect((await events(t.key)).map((e: { kind: string }) => e.kind)).toEqual(['updated', 'restored', 'trashed', 'created']);

      const again = await post(`/api/tickets/${t.key}/restore`);
      expect(again.status).toBe(409);
    });
  });

  test('the board reads live tickets by app and by project, ordered by id', async () => {
    const app = await newApp('A');
    const project = await newProject('P', app.id);
    await newTicket({ title: 'orphan' });
    await newTicket({ title: 'in app', app_id: app.id });
    await newTicket({ title: 'in project', project_id: project.id });

    const titles = (qs: string) => req(`/api/tickets${qs}`).then(async (r) => (await r.json()).map((t: { title: string }) => t.title));
    expect(await titles('')).toEqual(['orphan', 'in app', 'in project']);
    expect(await titles(`?app_id=${app.id}`)).toEqual(['in app', 'in project']);
    expect(await titles(`?project_id=${project.id}`)).toEqual(['in project']);
    expect(await titles('?app_id=null')).toEqual(['orphan']);
  });
});

describe('/api/settings', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  test('the prefix changes every displayed key at once and no ticket number', async () => {
    const t = await req('/api/tickets', json('POST', { title: 'x' })).then((r) => r.json());
    expect(t.key).toBe('GF-1');

    const res = await req('/api/settings', json('PATCH', { ticket_prefix: 'sr' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket_prefix: 'SR' });

    const after = await req('/api/tickets/GF-1').then((r) => r.json());
    expect(after).toMatchObject({ id: 1, key: 'SR-1' });
    expect(await req('/api/settings').then((r) => r.json())).toEqual({ ticket_prefix: 'SR' });
  });

  test('a prefix that is not a letter followed by letters or digits is refused', async () => {
    const bad = await req('/api/settings', json('PATCH', { ticket_prefix: '1x' }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).issues).toEqual([{ path: ['ticket_prefix'], message: 'a letter followed by up to 7 letters or digits' }]);
    expect(await req('/api/settings').then((r) => r.json())).toEqual({ ticket_prefix: 'GF' });
  });
});
