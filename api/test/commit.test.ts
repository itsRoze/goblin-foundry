import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { pinnedTicketWrite } from '../src/commit';
import { AtomicWriteError, atomically } from '../src/db';
import { ticket as ticketTable } from '../src/schema';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

/** The pin, column by column: a row that differs from the one read in any of them is a write that matches nothing. */
describe('pinnedTicketWrite', () => {
  let h: Harness;
  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  const stored = async (id: number) => (await h.db.select().from(ticketTable).where(eq(ticketTable.id, id)))[0]!;
  const create = async () => {
    const res = await h.app.request('/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'pinned' }) });
    return stored((await res.json()).id);
  };

  test('the row as read goes through, and the written row comes back', async () => {
    const row = await create();
    const [written] = await atomically(h.db, [pinnedTicketWrite(h.db, row, { title: 'moved' }, '2026-11-02T00:00:00.000Z')]);
    expect(written).toMatchObject({ id: row.id, title: 'moved', updated_at: '2026-11-02T00:00:00.000Z' });
  });

  test.each([
    ['status', { status: 'todo' as const }],
    ['updated_at', { updated_at: '2000-01-01T00:00:00.000Z' }],
    ['trashed_at', { trashed_at: '2000-01-01T00:00:00.000Z' }],
  ])('a row whose %s is not what was read is stale, and nothing is written', async (_column, moved) => {
    const row = await create();
    const attempt = atomically(h.db, [pinnedTicketWrite(h.db, { ...row, ...moved }, { title: 'moved' }, '2026-11-02T00:00:00.000Z')]);
    await expect(attempt).rejects.toBeInstanceOf(AtomicWriteError);
    await expect(attempt).rejects.toMatchObject({ kind: 'stale', what: `ticket ${row.id}` });
    expect(await stored(row.id)).toEqual(row);
  });

  test('a trashed row is pinned to its own trash time', async () => {
    const row = await create();
    await h.app.request(`/api/tickets/${row.id}`, { method: 'DELETE' });
    const trashed = await stored(row.id);
    const [written] = await atomically(h.db, [pinnedTicketWrite(h.db, trashed, { trashed_at: null }, '2026-11-02T00:00:00.000Z')]);
    expect(written).toMatchObject({ id: row.id, trashed_at: null });
    await expect(atomically(h.db, [pinnedTicketWrite(h.db, trashed, { title: 'again' }, '2026-11-02T00:00:00.000Z')])).rejects.toMatchObject({ kind: 'stale' });
  });
});
