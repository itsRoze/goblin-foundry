import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';
import { openDb } from '../src/db';
import { createApp } from '../src/app';

describe('implementation links', () => {
  let h: Awaited<ReturnType<typeof makeTestApp>>;
  beforeEach(async () => { h = await makeTestApp(); });
  afterEach(() => h.close());
  const post = (path: string, body: unknown) => h.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goblin-Actor': 'agent' }, body: JSON.stringify(body) });
  const create = () => post('/api/tickets', { title: 'Implement offline reading' });
  const path = '/api/tickets/GF-1/implementation-links';
  const list = async () => (await h.app.request(path)).json();

  test('multiple URLs persist across reopening, leave status alone, and record add/remove history', async () => {
    await create();
    const first = await post(path, { url: ' https://github.com/example/reader/pull/14 ' });
    expect(first.status).toBe(201);
    const pr = await first.json();
    expect((await post(path, { url: 'https://github.com/example/reader/commit/abc123' })).status).toBe(201);
    const reopened = await openDb(h.path);
    try {
      expect((await (await createApp(reopened.db).request(path)).json()).length).toBe(2);
    } finally { reopened.close(); }
    expect((await (await h.app.request('/api/tickets/GF-1')).json()).status).toBe('planning');
    expect((await h.app.request(`${path}/${pr.id}`, { method: 'DELETE', headers: { 'X-Goblin-Actor': 'agent' } })).status).toBe(204);
    expect(await list()).toHaveLength(1);
    const history = await (await h.app.request('/api/tickets/GF-1/events')).json();
    expect(history.filter((e: { kind: string }) => e.kind === 'implementation_link_added')).toHaveLength(2);
    expect(history[0]).toMatchObject({ kind: 'implementation_link_removed', actor: 'agent', prior: { url: pr.url }, new: { url: null } });
  });

  test('duplicate concurrent submissions are idempotent; removal is scoped to the owning ticket', async () => {
    await create();
    const url = 'https://github.com/example/reader/pull/14';
    const results = await Promise.all([post(path, { url }), post(path, { url })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const links = await list();
    expect(links).toHaveLength(1);
    await create();
    expect((await h.app.request(`/api/tickets/GF-2/implementation-links/${links[0].id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await list()).toHaveLength(1);
    const history = await (await h.app.request('/api/tickets/GF-1/events')).json();
    expect(history.filter((e: { kind: string }) => e.kind === 'implementation_link_added')).toHaveLength(1);
  });

  test('invalid URLs are refused and links survive ticket trash/restore', async () => {
    await create();
    for (const url of ['javascript:alert(1)', 'file:///tmp/commit', 'abc123', 'https://', 'https://example.com/' + 'x'.repeat(2048)]) {
      expect((await post(path, { url })).status).toBe(422);
    }
    expect(await list()).toEqual([]);
    await post(path, { url: 'https://git.example.org/team/app/-/merge_requests/3' });
    await h.app.request('/api/tickets/GF-1', { method: 'DELETE' });
    expect((await h.app.request(path)).status).toBe(404);
    expect((await post(path, { url: 'https://example.com/commit/abc' })).status).toBe(404);
    await h.app.request('/api/tickets/GF-1/restore', { method: 'POST' });
    expect(await list()).toHaveLength(1);
  });

  test('a history failure rolls back adding or removing a link', async () => {
    await create();
    const url = 'https://github.com/example/reader/pull/14';
    h.failWrites('event', 1);
    expect((await post(path, { url })).status).toBe(500);
    expect(await list()).toEqual([]);
    h.healWrites();
    const link = await (await post(path, { url })).json();
    h.failWrites('event', 1);
    expect((await h.app.request(`${path}/${link.id}`, { method: 'DELETE' })).status).toBe(500);
    expect(await list()).toHaveLength(1);
  });
});
