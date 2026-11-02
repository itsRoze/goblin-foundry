/**
 * A Ticket's Labels (ADR-0013). The rules are the `@goblin/labels` Piece's,
 * read through `ticketLabels` in `shared`; this module is only where they are
 * stored. The one write is the whole set (ADR-0004): add and remove are a
 * client's arithmetic over it, and the set, the ticket's `updated_at` and the
 * history row commit together or not at all. Two clients adding at once can
 * still each send the set they read (no optimistic concurrency in S1).
 */
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { SetLabelsBodySchema, ticketLabels } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { changedUnderneath, commit, pinnedTicketWrite } from './commit';
import type { AtomicWrite, Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { unprocessable, type Issue } from './problems';
import { ticket as ticketTable, ticketLabel, type TicketRow } from './schema';

/** One ticket's labels, in the order they were set. */
export async function labelsOf(db: Db, id: number): Promise<string[]> {
  const rows = await db.select({ name: ticketLabel.name }).from(ticketLabel).where(eq(ticketLabel.ticket_id, id)).orderBy(asc(ticketLabel.position));
  return rows.map((row) => row.name);
}

/** Every ticket's labels in one query — a list read costs one statement, never one per row — looked up by ticket id; a ticket with none has `[]`. */
export async function labelsByTicket(db: Db): Promise<(id: number) => string[]> {
  const map = new Map<number, string[]>();
  const rows = await db.select().from(ticketLabel).orderBy(asc(ticketLabel.ticket_id), asc(ticketLabel.position));
  for (const row of rows) map.set(row.ticket_id, [...(map.get(row.ticket_id) ?? []), row.name]);
  return (id) => map.get(id) ?? [];
}

/**
 * `GET /api/labels`: the names in use, sorted — every label a live ticket
 * carries, whatever its app or status. A trashed ticket's are not in use:
 * nothing on the board carries them, though they come back with it on restore.
 */
export function labelNamesRoutes(db: Db) {
  const r = new Hono<ActorEnv>();
  r.get('/', async (c) => {
    const rows = await db
      .selectDistinct({ name: ticketLabel.name })
      .from(ticketLabel)
      .innerJoin(ticketTable, eq(ticketTable.id, ticketLabel.ticket_id))
      .where(isNull(ticketTable.trashed_at))
      .orderBy(asc(ticketLabel.name));
    return c.json(rows.map((row) => row.name));
  });
  return r;
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
export const labelInserts = (db: Db, ticket_id: number | SQL<number>, labels: readonly string[]): AtomicWrite[] =>
  labels.map((name, position) => ({
    what: `label ${name}`,
    statement: db.insert(ticketLabel).values({ ticket_id, name, position }).returning({ name: ticketLabel.name }),
  }));

/** Both are judged, so neither repeats a name: the same length and every name shared is the same set, whatever the order. */
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name) => b.includes(name));

export function labelRoutes(
  r: Hono<ActorEnv>,
  deps: { db: Db; find: (c: Context) => Promise<TicketRow | undefined>; missing: (c: Context) => Response; toWire: (row: TicketRow) => Promise<unknown> },
) {
  const { db, find, missing, toWire } = deps;

  r.post('/:key/labels', async (c) => {
    const row = await find(c);
    if (!row) return missing(c);
    const body = await parseBody(c, SetLabelsBodySchema);
    if (!body.ok) return body.response;
    const judged = judgeLabels(body.data.labels);
    if (!judged.ok) return unprocessable(c, [judged.issue]);
    const prior = await labelsOf(db, row.id);
    // the same set said twice, in any order, is not news
    if (sameSet(prior, judged.labels)) return c.json(await toWire(row));

    const at = now();
    const written = await commit(
      c,
      db,
      [
        // the ticket as read, so two clients' sets never interleave
        pinnedTicketWrite(db, row, {}, at),
        ...prior.map((name) => ({
          what: `label ${name}`,
          statement: db
            .delete(ticketLabel)
            .where(and(eq(ticketLabel.ticket_id, row.id), eq(ticketLabel.name, name)))
            .returning({ name: ticketLabel.name }),
        })),
        ...labelInserts(db, row.id, judged.labels),
        await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'labelled', prior: { labels: prior }, new: { labels: judged.labels }, at }),
      ],
      { rolledBack: 'the labels were rolled back', stale: () => changedUnderneath(c, db, row.id, 'its labels') },
    );
    if (written instanceof Response) return written;
    return c.json(await toWire(written[0] as TicketRow));
  });
}
