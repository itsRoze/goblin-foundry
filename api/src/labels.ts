/**
 * A Ticket's Labels (ADR-0013). The rules are the `@goblin/labels` Piece's,
 * read through `ticketLabels` in `shared`; this module is only where they are
 * stored. The one write is the whole set (ADR-0004): add and remove are a
 * client's arithmetic over it, and the set, the ticket's `updated_at` and the
 * history row commit together or not at all. Two clients adding at once can
 * still each send the set they read (no optimistic concurrency in S1).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { SetLabelsBodySchema, ticketKey, ticketLabels } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { AtomicWriteError, atomically, type AtomicWrite, type Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { conflict, failed, unprocessable, type Issue } from './problems';
import { ticket as ticketTable, ticketLabel, type TicketRow } from './schema';

/** One ticket's labels, in the order they were set. */
export async function labelsOf(db: Db, id: number): Promise<string[]> {
  const rows = await db.select({ name: ticketLabel.name }).from(ticketLabel).where(eq(ticketLabel.ticket_id, id)).orderBy(asc(ticketLabel.position));
  return rows.map((row) => row.name);
}

/** Every ticket's labels, by ticket id, in one query — a list read costs one statement, never one per row. */
export async function labelsByTicket(db: Db): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  const rows = await db.select().from(ticketLabel).orderBy(asc(ticketLabel.ticket_id), asc(ticketLabel.position));
  for (const row of rows) map.set(row.ticket_id, [...(map.get(row.ticket_id) ?? []), row.name]);
  return map;
}

/**
 * A proposed set judged by the Piece: the normalised set, or the Piece's own
 * sentence as an issue on `labels` — the field the body got wrong.
 */
export function judgeLabels(proposed: readonly string[]): { ok: true; labels: string[] } | { ok: false; issue: Issue } {
  const judged = ticketLabels.judge(proposed);
  return judged.ok ? { ok: true, labels: [...judged.labels] } : { ok: false, issue: { path: ['labels'], message: judged.refusal } };
}

/** The rows a fresh set is written as, one statement each so a batch can prove every one landed. */
export const labelInserts = (db: Db, ticket_id: number, labels: readonly string[]): AtomicWrite[] =>
  labels.map((name, position) => ({
    what: `label ${name}`,
    statement: db.insert(ticketLabel).values({ ticket_id, name, position }).returning({ name: ticketLabel.name }),
  }));

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name, i) => name === b[i]);

export function labelRoutes(
  r: Hono<ActorEnv>,
  deps: { db: Db; find: (c: Context) => Promise<TicketRow | undefined>; missing: (c: Context) => Response; prefix: () => Promise<string>; toWire: (row: TicketRow) => Promise<unknown> },
) {
  const { db, find, missing, prefix, toWire } = deps;

  r.post('/:key/labels', async (c) => {
    const row = await find(c);
    if (!row) return missing(c);
    const body = await parseBody(c, SetLabelsBodySchema);
    if (!body.ok) return body.response;
    const judged = judgeLabels(body.data.labels);
    if (!judged.ok) return unprocessable(c, [judged.issue]);
    const prior = await labelsOf(db, row.id);
    // the same set said twice is not news
    if (sameSet(prior, judged.labels)) return c.json(await toWire(row));

    const at = now();
    try {
      await atomically(db, [
        {
          what: `ticket ${row.id}`,
          // the ticket as read: live and not written since, so two clients' sets never interleave
          statement: db
            .update(ticketTable)
            .set({ updated_at: at })
            .where(and(eq(ticketTable.id, row.id), eq(ticketTable.updated_at, row.updated_at), isNull(ticketTable.trashed_at)))
            .returning({ id: ticketTable.id }),
        },
        ...prior.map((name) => ({
          what: `label ${name}`,
          statement: db
            .delete(ticketLabel)
            .where(and(eq(ticketLabel.ticket_id, row.id), eq(ticketLabel.name, name)))
            .returning({ name: ticketLabel.name }),
        })),
        ...labelInserts(db, row.id, judged.labels),
        await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'labelled', prior: { labels: prior }, new: { labels: judged.labels }, at }),
      ]);
    } catch (error) {
      if (!(error instanceof AtomicWriteError)) throw error;
      if (error.kind === 'fault') return failed(c, `nothing changed — the labels were rolled back (${error.message})`);
      return conflict(c, `nothing changed — ticket ${ticketKey(await prefix(), row.id)} changed while its labels were being set; try again`);
    }

    const [updated] = await db.select().from(ticketTable).where(eq(ticketTable.id, row.id));
    if (!updated) throw new Error('labels committed but the ticket is gone');
    return c.json(await toWire(updated));
  });
}
