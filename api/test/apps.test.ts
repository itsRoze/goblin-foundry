import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('/api/apps', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  test('creates an app with a repository and default branch, then lists it', async () => {
    const res = await req(
      '/api/apps',
      json('POST', {
        name: 'Subway Reader',
        repository_url: 'https://github.com/itsRoze/subway-reader',
        default_branch: 'main',
        description: 'An RSS reader for the subway',
      }),
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({
      id: 1,
      name: 'Subway Reader',
      repository_url: 'https://github.com/itsRoze/subway-reader',
      default_branch: 'main',
      description: 'An RSS reader for the subway',
      archived_at: null,
      trashed_at: null,
    });
    expect(typeof created.created_at).toBe('string');

    const list = await req('/api/apps');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([created]);
  });

  test('validation: default_branch needs a repository_url, lifecycle fields are not writable, URLs must be URLs', async () => {
    const branchOnly = await req('/api/apps', json('POST', { name: 'X', default_branch: 'main' }));
    expect(branchOnly.status).toBe(422);
    expect(branchOnly.headers.get('content-type')).toContain('application/problem+json');
    const body = await branchOnly.json();
    expect(body.status).toBe(422);
    expect(body.issues).toEqual([{ path: ['default_branch'], message: 'default_branch requires a repository_url' }]);

    const archived = await req('/api/apps', json('POST', { name: 'X', archived_at: '2026-01-01T00:00:00Z' }));
    expect(archived.status).toBe(422);
    expect((await archived.json()).issues.map((i: { path: string[] }) => i.path)).toContainEqual(['archived_at']);

    const badUrl = await req('/api/apps', json('POST', { name: 'X', repository_url: 'not a url' }));
    expect(badUrl.status).toBe(422);
    expect((await badUrl.json()).issues[0].path).toEqual(['repository_url']);

    const noName = await req('/api/apps', json('POST', { description: 'nameless' }));
    expect(noName.status).toBe(422);

    expect(await req('/api/apps').then((r) => r.json())).toEqual([]);
  });

  test('an unknown actor header is refused; a missing id is a problem+json 404', async () => {
    const actor = await req('/api/apps', json('POST', { name: 'X' }, { 'X-Goblin-Actor': 'robot' }));
    expect(actor.status).toBe(422);
    expect((await actor.json()).issues[0].path).toEqual(['X-Goblin-Actor']);

    const missing = await req('/api/apps/99');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    expect(await missing.json()).toEqual({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'app 99 not found' });
  });

  test('renaming changes only the name and is recorded as an event with the actor', async () => {
    const created = await req('/api/apps', json('POST', { name: 'Subway Reeder', description: 'd' })).then((r) => r.json());
    const res = await req(`/api/apps/${created.id}`, json('PATCH', { name: 'Subway Reader' }, { 'X-Goblin-Actor': 'agent' }));
    expect(res.status).toBe(200);
    const renamed = await res.json();
    expect(renamed).toMatchObject({ id: created.id, name: 'Subway Reader', description: 'd', repository_url: null });

    const got = await req(`/api/apps/${created.id}`).then((r) => r.json());
    expect(got).toEqual(renamed);

    const events = await req(`/api/apps/${created.id}/events`).then((r) => r.json());
    expect(events.map((e: { kind: string; actor: string }) => [e.kind, e.actor])).toEqual([
      ['updated', 'agent'],
      ['created', 'human'],
    ]);
    expect(events[0]).toMatchObject({ entity_kind: 'app', entity_id: created.id, prior: { name: 'Subway Reeder' }, new: { name: 'Subway Reader' } });
    expect(events[1].prior).toBeNull();
    expect(events[1].new).toEqual({ name: 'Subway Reeder', description: 'd', repository_url: null, default_branch: null });
  });

  test('patch: default_branch is refused when the app has no repository, and a body with trashed_at is refused', async () => {
    const created = await req('/api/apps', json('POST', { name: 'X' })).then((r) => r.json());
    const branch = await req(`/api/apps/${created.id}`, json('PATCH', { default_branch: 'main' }));
    expect(branch.status).toBe(422);
    const both = await req(`/api/apps/${created.id}`, json('PATCH', { default_branch: 'main', repository_url: 'https://x.dev/r' }));
    expect(both.status).toBe(200);
    const trashed = await req(`/api/apps/${created.id}`, json('PATCH', { trashed_at: null }));
    expect(trashed.status).toBe(422);
    const noop = await req(`/api/apps/${created.id}`, json('PATCH', {}));
    expect(noop.status).toBe(200);
    const events = await req(`/api/apps/${created.id}/events`).then((r) => r.json());
    expect(events).toHaveLength(2); // created + the one real update; the no-op wrote nothing
  });

  test('archiving hides an app from the list, ?archived=1 reveals it, and a second archive is a 409 with a hint', async () => {
    const a = await req('/api/apps', json('POST', { name: 'Keep' })).then((r) => r.json());
    const b = await req('/api/apps', json('POST', { name: 'Old' })).then((r) => r.json());

    const archived = await req(`/api/apps/${b.id}/archive`, json('POST'));
    expect(archived.status).toBe(200);
    expect(typeof (await archived.json()).archived_at).toBe('string');

    const names = (rows: { name: string }[]) => rows.map((r) => r.name);
    expect(names(await req('/api/apps').then((r) => r.json()))).toEqual(['Keep']);
    expect(names(await req('/api/apps?archived=1').then((r) => r.json()))).toEqual(['Keep', 'Old']);
    // still opens by its address
    expect((await req(`/api/apps/${b.id}`)).status).toBe(200);

    const again = await req(`/api/apps/${b.id}/archive`, json('POST'));
    expect(again.status).toBe(409);
    expect(again.headers.get('content-type')).toContain('application/problem+json');
    expect(await again.json()).toMatchObject({ status: 409, owner: 'human', hint: expect.stringContaining('already archived') });

    const notArchived = await req(`/api/apps/${a.id}/unarchive`, json('POST'));
    expect(notArchived.status).toBe(409);

    const back = await req(`/api/apps/${b.id}/unarchive`, json('POST'));
    expect(back.status).toBe(200);
    expect((await back.json()).archived_at).toBeNull();
    expect(names(await req('/api/apps').then((r) => r.json()))).toEqual(['Keep', 'Old']);

    const events = await req(`/api/apps/${b.id}/events`).then((r) => r.json());
    expect(events.map((e: { kind: string }) => e.kind)).toEqual(['unarchived', 'archived', 'created']);
    expect(events[1].prior).toEqual({ archived_at: null });
    expect(events[1].new).toEqual({ archived_at: expect.any(String) });
  });

  test('trashing hides an app everywhere but /api/trash; restore brings it back', async () => {
    const a = await req('/api/apps', json('POST', { name: 'Oops' })).then((r) => r.json());
    const trashed = await req(`/api/apps/${a.id}`, { method: 'DELETE' });
    expect(trashed.status).toBe(200);
    expect(typeof (await trashed.json()).trashed_at).toBe('string');

    expect(await req('/api/apps?archived=1').then((r) => r.json())).toEqual([]);
    expect((await req(`/api/apps/${a.id}`)).status).toBe(404);
    expect((await req(`/api/apps/${a.id}`, json('PATCH', { name: 'x' }))).status).toBe(404);
    expect((await req(`/api/apps/${a.id}/archive`, json('POST'))).status).toBe(404);
    const twice = await req(`/api/apps/${a.id}`, { method: 'DELETE' });
    expect(twice.status).toBe(409);
    expect((await twice.json()).hint).toContain('already in the trash');

    const trash = await req('/api/trash').then((r) => r.json());
    expect(trash.apps).toEqual([expect.objectContaining({ id: a.id, name: 'Oops', trashed_at: expect.any(String) })]);
    expect(trash.projects).toEqual([]);

    const restored = await req(`/api/apps/${a.id}/restore`, json('POST'));
    expect(restored.status).toBe(200);
    expect((await restored.json()).trashed_at).toBeNull();
    expect((await req(`/api/apps/${a.id}/restore`, json('POST'))).status).toBe(409);
    expect((await req('/api/trash').then((r) => r.json())).apps).toEqual([]);
    expect((await req('/api/apps').then((r) => r.json())).map((r: { id: number }) => r.id)).toEqual([a.id]);

    const kinds = (await req(`/api/apps/${a.id}/events`).then((r) => r.json())).map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(['restored', 'trashed', 'created']);
  });
});
