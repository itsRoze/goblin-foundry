import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TicketStatus, TransitionName } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** How to walk from `backlog` to each status using nothing but legal edges (mirrors `transitions.test.ts`). */
const ROUTE: Record<TicketStatus, TransitionName[]> = {
  backlog: [],
  todo: ['pick'],
  planning: ['plan'],
  ready: ['pick', 'approve'],
  building: ['pick', 'approve', 'start'],
  review: ['pick', 'approve', 'start', 'submit'],
  done: ['pick', 'approve', 'start', 'submit', 'ship'],
  cancelled: ['cancel'],
};

describe('dependencies', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const del = (path: string) => req(path, { method: 'DELETE' });
  const read = (key: string) => req(`/api/tickets/${key}`).then((r) => r.json());
  const list = () => req('/api/tickets').then((r) => r.json());
  const frontier = () => req('/api/frontier').then((r) => r.json());
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());

  let appId: number;
  beforeEach(async () => {
    h = await makeTestApp();
    appId = (await post('/api/apps', { name: 'foundry' }).then((r) => r.json())).id;
  });
  afterEach(() => h.close());

  /** A simple ticket (so the approve guard passes) parked at `status`. */
  const ticket = async (title: string, status: TicketStatus = 'backlog') => {
    const t = await post('/api/tickets', { title, app_id: appId, simple: true }).then((r) => r.json());
    for (const name of ROUTE[status]) expect((await post(`/api/tickets/${t.key}/${name}`)).status).toBe(200);
    return read(t.key);
  };

  /** `a` blocks `b`. */
  const block = (blocker: { key: string }, blocked: { key: string }) => post(`/api/tickets/${blocked.key}/dependencies`, { blocker: blocker.key });

  test('an edge blocks the waiting ticket, is visible from both ends, and is undone by DELETE', async () => {
    const a = await ticket('the blocker');
    const b = await ticket('the waiter');

    const added = await block(a, b);
    expect(added.status).toBe(200);
    const body = await added.json();
    expect(body.blocked_by).toEqual([a.key]);
    expect(body.dependencies).toEqual({
      depends_on: [{ key: a.key, title: 'the blocker', status: 'backlog' }],
      blocks: [],
    });
    expect((await read(a.key)).dependencies.blocks).toEqual([{ key: b.key, title: 'the waiter', status: 'backlog' }]);
    expect((await read(a.key)).blocked_by).toEqual([]);

    const removed = await del(`/api/tickets/${b.key}/dependencies/${a.key}`);
    expect(removed.status).toBe(200);
    expect((await removed.json()).blocked_by).toEqual([]);
    expect((await read(a.key)).dependencies.blocks).toEqual([]);
  });

  test('re-declaring the same edge is idempotent — one edge, one pair of events', async () => {
    const a = await ticket('a');
    const b = await ticket('b');
    await block(a, b);
    expect((await block(a, b)).status).toBe(200);
    expect((await read(b.key)).dependencies.depends_on).toHaveLength(1);
    expect((await events(b.key)).filter((e: { kind: string }) => e.kind === 'dependency_added')).toHaveLength(1);
  });

  test('both ends get an event naming the other, on add and on remove', async () => {
    const a = await ticket('a');
    const b = await ticket('b');
    await block(a, b);
    await del(`/api/tickets/${b.key}/dependencies/${a.key}`);

    const kinds = (rows: { kind: string; new: Record<string, unknown> }[]) => rows.filter((e) => e.kind.startsWith('dependency_')).map((e) => [e.kind, e.new]);
    expect(kinds(await events(b.key))).toEqual([
      ['dependency_removed', { blocker: a.key }],
      ['dependency_added', { blocker: a.key }],
    ]);
    expect(kinds(await events(a.key))).toEqual([
      ['dependency_removed', { blocked: b.key }],
      ['dependency_added', { blocked: b.key }],
    ]);
  });

  test('a cycle is refused with a 409 and a hint; self-dependency is the one-node case', async () => {
    const a = await ticket('a');
    const b = await ticket('b');
    const c = await ticket('c');
    await block(a, b);
    await block(b, c);

    const cycle = await block(c, a);
    expect(cycle.status).toBe(409);
    expect(cycle.headers.get('content-type')).toContain('application/problem+json');
    expect((await cycle.json()).hint).toBe(`${c.key} already waits on ${a.key} — that would be a cycle`);

    const self = await block(a, a);
    expect(self.status).toBe(409);
    expect((await self.json()).hint).toBe(`${a.key} cannot block itself`);
    expect((await read(a.key)).dependencies.depends_on).toEqual([]);
  });

  test('the cycle walk ignores statuses, so reopening can never reveal one nobody was asked about', async () => {
    const a = await ticket('a');
    const b = await ticket('b');
    await block(a, b);
    // a is shipped: it no longer blocks anything, but the edge is still a declared fact
    for (const name of ['pick', 'approve', 'start', 'submit', 'ship'] as const) await post(`/api/tickets/${a.key}/${name}`);
    expect((await read(b.key)).blocked_by).toEqual([]);

    const cycle = await block(b, a);
    expect(cycle.status).toBe(409);
  });

  test('a done or cancelled blocker is accepted and inert; reopening it bites', async () => {
    const done = await ticket('already shipped', 'done');
    const cancelled = await ticket('not doing', 'cancelled');
    const b = await ticket('b');

    expect((await block(done, b)).status).toBe(200);
    expect((await block(cancelled, b)).status).toBe(200);
    expect((await read(b.key)).blocked_by).toEqual([]);
    // both are still declared — the chips show them, struck through
    expect((await read(b.key)).dependencies.depends_on.map((d: { key: string }) => d.key)).toEqual([done.key, cancelled.key]);

    await post(`/api/tickets/${cancelled.key}/reopen`);
    expect((await read(b.key)).blocked_by).toEqual([cancelled.key]);
  });

  test('a new edge may not touch the trash, but an existing one survives it', async () => {
    const a = await ticket('a');
    const b = await ticket('b');
    await block(a, b);
    await del(`/api/tickets/${a.key}`);

    expect((await read(b.key)).blocked_by).toEqual([]);
    expect((await read(b.key)).dependencies.depends_on.map((d: { key: string }) => d.key)).toEqual([a.key]);

    const trashedBlocker = await post(`/api/tickets/${b.key}/dependencies`, { blocker: a.key });
    expect(trashedBlocker.status).toBe(422);
    expect((await trashedBlocker.json()).issues).toEqual([{ path: ['blocker'], message: `ticket ${a.key} is in the trash` }]);

    // a trashed *blocked* ticket is not addressable at all
    await del(`/api/tickets/${b.key}`);
    expect((await post(`/api/tickets/${b.key}/dependencies`, { blocker: a.key })).status).toBe(404);

    await post(`/api/tickets/${a.key}/restore`);
    await post(`/api/tickets/${b.key}/restore`);
    expect((await read(b.key)).blocked_by).toEqual([a.key]);
  });

  test('a blocker that is not a ticket, and a removal of an edge that was never declared', async () => {
    const b = await ticket('b');
    const nonsense = await post(`/api/tickets/${b.key}/dependencies`, { blocker: 'not-a-key' });
    expect(nonsense.status).toBe(422);
    expect((await nonsense.json()).issues[0].message).toBe('not-a-key is not a ticket key');

    const absent = await post(`/api/tickets/${b.key}/dependencies`, { blocker: 'GF-99' });
    expect(absent.status).toBe(422);
    expect((await absent.json()).issues[0].message).toBe('ticket GF-99 not found');

    const gone = await del(`/api/tickets/${b.key}/dependencies/GF-99`);
    expect(gone.status).toBe(404);
    expect((await gone.json()).detail).toBe(`GF-99 does not block ${b.key}`);
  });

  test('list reads carry blocked_by; the trash does not', async () => {
    const a = await ticket('a');
    const b = await ticket('b');
    await block(a, b);
    expect(Object.fromEntries((await list()).map((t: { key: string; blocked_by: string[] }) => [t.key, t.blocked_by]))).toEqual({ [a.key]: [], [b.key]: [a.key] });

    await del(`/api/tickets/${b.key}`);
    const trash = await req('/api/trash').then((r) => r.json());
    expect(trash.tickets[0].blocked_by).toEqual([]);
  });

  test('blockedness never gates a transition — a blocked ticket still starts', async () => {
    const a = await ticket('a');
    const b = await ticket('b', 'ready');
    await block(a, b);
    expect((await read(b.key)).blocked_by).toEqual([a.key]);
    const started = await post(`/api/tickets/${b.key}/start`);
    expect(started.status).toBe(200);
    expect((await started.json()).status).toBe('building');
  });

  describe('GET /api/frontier', () => {
    test('ready tickets with no open blocker, stalest first', async () => {
      const free = await ticket('free', 'ready');
      const blocked = await ticket('blocked', 'ready');
      const notReady = await ticket('still an idea');
      const blocker = await ticket('blocker');
      await block(blocker, blocked);

      expect((await frontier()).map((t: { key: string }) => t.key)).toEqual([free.key]);
      expect((await frontier())[0]).toMatchObject({ key: free.key, status: 'ready', blocked_by: [] });
      expect((await frontier()).map((t: { key: string }) => t.key)).not.toContain(notReady.key);

      // shipping the blocker frees the waiter, which is now the stalest of the two
      for (const name of ['pick', 'approve', 'start', 'submit', 'ship'] as const) await post(`/api/tickets/${blocker.key}/${name}`);
      expect((await frontier()).map((t: { key: string }) => t.key)).toEqual([free.key, blocked.key]);
    });

    test('done, cancelled and trashed blockers all leave the waiter on the frontier; an open one does not', async () => {
      const cases: [string, TicketStatus | 'trashed'][] = [
        ['done', 'done'],
        ['cancelled', 'cancelled'],
        ['trashed', 'trashed'],
        ['open', 'backlog'],
      ];
      const waiters = new Map<string, string>();
      for (const [name, state] of cases) {
        const waiter = await ticket(`waiting on ${name}`, 'ready');
        const blocker = await ticket(`${name} blocker`, state === 'trashed' ? 'backlog' : state);
        await block(blocker, waiter);
        if (state === 'trashed') await del(`/api/tickets/${blocker.key}`);
        waiters.set(name, waiter.key);
      }
      const keys: string[] = (await frontier()).map((t: { key: string }) => t.key);
      expect(keys.sort()).toEqual(['done', 'cancelled', 'trashed'].map((n) => waiters.get(n)!).sort());
    });

    test('a chain of two: the middle ticket only reaches the frontier when its own blocker is gone', async () => {
      const first = await ticket('first');
      const middle = await ticket('middle', 'ready');
      const last = await ticket('last', 'ready');
      await block(first, middle);
      await block(middle, last);

      expect(await frontier()).toEqual([]);
      for (const name of ['pick', 'approve', 'start', 'submit', 'ship'] as const) await post(`/api/tickets/${first.key}/${name}`);
      expect((await frontier()).map((t: { key: string }) => t.key)).toEqual([middle.key]);
    });
  });
});
