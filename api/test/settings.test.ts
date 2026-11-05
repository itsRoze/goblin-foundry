import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { event } from '../src/schema';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

describe('GET /api/settings', () => {
  let harness: Harness | undefined;
  afterEach(() => harness?.close());

  test('a fresh database reports the default ticket prefix GF and Worktree root', async () => {
    harness = await makeTestApp();
    const res = await harness.app.request('/api/settings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ticket_prefix: 'GF', worktree_root: '~/.goblin/worktrees', terminal_step: 'none' });
  });
});

describe('PATCH /api/settings changes the Worktree root', () => {
  let h: Harness;
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const patch = (body: unknown) => Promise.resolve(h.app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-goblin-actor': 'agent' }, body: JSON.stringify(body) }));
  const read = () => Promise.resolve(h.app.request('/api/settings')).then((r) => r.json());
  const history = () => h.db.select({ actor: event.actor, kind: event.kind, prior: event.prior, new: event.new }).from(event).where(and(eq(event.entity_kind, 'setting'), eq(event.entity_id, 0)));

  test('on its own, leaving the prefix alone, and the history holds only what changed', async () => {
    const res = await patch({ worktree_root: '/srv/worktrees' });
    expect([res.status, await res.json()]).toEqual([200, { ticket_prefix: 'GF', worktree_root: '/srv/worktrees', terminal_step: 'none' }]);
    expect(await read()).toEqual({ ticket_prefix: 'GF', worktree_root: '/srv/worktrees', terminal_step: 'none' });
    expect(await history()).toEqual([{ actor: 'agent', kind: 'updated', prior: { worktree_root: '~/.goblin/worktrees' }, new: { worktree_root: '/srv/worktrees' } }]);
  });

  test('together with the prefix, as one event', async () => {
    expect((await patch({ ticket_prefix: 'sr', worktree_root: '~/elsewhere' })).status).toBe(200);
    expect(await read()).toEqual({ ticket_prefix: 'SR', worktree_root: '~/elsewhere', terminal_step: 'none' });
    expect(await history()).toEqual([
      { actor: 'agent', kind: 'updated', prior: { ticket_prefix: 'GF', worktree_root: '~/.goblin/worktrees' }, new: { ticket_prefix: 'SR', worktree_root: '~/elsewhere' } },
    ]);
  });

  test('a save that changes nothing writes nothing', async () => {
    expect((await patch({ ticket_prefix: 'GF', worktree_root: '~/.goblin/worktrees' })).status).toBe(200);
    expect(await history()).toEqual([]);
  });

  test("a relative root, whose meaning would be the server's working directory, is refused with a sentence", async () => {
    const res = await patch({ worktree_root: 'worktrees' });
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: ['worktree_root'], message: 'an absolute folder, or one under ~' }]);
    expect((await read()).worktree_root).toBe('~/.goblin/worktrees');
  });

  test('a body that names no setting is refused', async () => {
    const res = await patch({});
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: [], message: 'name at least one setting' }]);
  });

  test('one failed row of a two-setting save keeps neither', async () => {
    h.failWrites('setting event', 0);
    expect((await patch({ ticket_prefix: 'SR', worktree_root: '/srv/worktrees' })).status).toBe(500);
    expect(await read()).toEqual({ ticket_prefix: 'GF', worktree_root: '~/.goblin/worktrees', terminal_step: 'none' });
  });
});

describe('PATCH /api/settings writes the prefix and its history together, against the prefix it read (ADR-0010)', () => {
  let h: Harness;
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const patch = (ticket_prefix: string) => Promise.resolve(h.app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket_prefix }) }));
  const read = () => Promise.resolve(h.app.request('/api/settings')).then((r) => r.json());
  /** The settings pseudo-entity has no history route, so its rows are read where they are stored. */
  const history = () => h.db.select({ kind: event.kind, prior: event.prior, new: event.new }).from(event).where(and(eq(event.entity_kind, 'setting'), eq(event.entity_id, 0)));

  test('a history write that fails leaves the prefix as it was, and the same save goes through once the fault is gone', async () => {
    h.failWrites('setting event', 0);
    const res = await patch('SR');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).detail).toBe('nothing changed — the settings were not saved (updated event for setting 0: injected fault)');
    expect(await read()).toMatchObject({ ticket_prefix: 'GF' });
    expect(await history()).toEqual([]);
    h.healWrites();
    expect([(await patch('SR')).status, (await read()).ticket_prefix]).toEqual([200, 'SR']);
    expect(await history()).toEqual([{ kind: 'updated', prior: { ticket_prefix: 'GF' }, new: { ticket_prefix: 'SR' } }]);
  });

  test('a prefix that changed between the read and the save is a 409, and nothing is written', async () => {
    h.failWrites('setting', 0, 'vanish');
    const res = await patch('SR');
    expect([res.status, (await res.json()).hint]).toEqual([409, 'nothing changed — the settings changed while the save was being applied; try again']);
    h.healWrites();
    expect(await read()).toMatchObject({ ticket_prefix: 'GF' });
    expect(await history()).toEqual([]);
  });
});
