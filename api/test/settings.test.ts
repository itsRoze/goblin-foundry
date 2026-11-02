import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { event } from '../src/schema';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

describe('GET /api/settings', () => {
  let harness: Harness | undefined;
  afterEach(() => harness?.close());

  test('a fresh database reports the default ticket prefix GF', async () => {
    harness = await makeTestApp();
    const res = await harness.app.request('/api/settings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ticket_prefix: 'GF' });
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
    expect(await read()).toEqual({ ticket_prefix: 'GF' });
    expect(await history()).toEqual([]);
    h.healWrites();
    expect([(await patch('SR')).status, await read()]).toEqual([200, { ticket_prefix: 'SR' }]);
    expect(await history()).toEqual([{ kind: 'updated', prior: { ticket_prefix: 'GF' }, new: { ticket_prefix: 'SR' } }]);
  });

  test('a prefix that changed between the read and the save is a 409, and nothing is written', async () => {
    h.failWrites('setting', 0, 'vanish');
    const res = await patch('SR');
    expect([res.status, (await res.json()).hint]).toEqual([409, 'nothing changed — the settings changed while the save was being applied; try again']);
    h.healWrites();
    expect(await read()).toEqual({ ticket_prefix: 'GF' });
    expect(await history()).toEqual([]);
  });
});
