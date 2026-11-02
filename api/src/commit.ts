/**
 * How a route writes a Ticket's row (ADR-0010): pinned to the version it
 * judged, in one batch with the history that records it, with one answer for
 * a batch that did not commit. `implementation-links.ts` holds a ticket to
 * "still live" rather than to a version, and `children.ts` still writes
 * sequentially (GF-37's follow-up).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { ticketKey } from '@goblin/shared';
import { AtomicWriteError, atomically, type AtomicWrite, type Db } from './db';
import { conflict, failed } from './problems';
import { ticket as ticketTable, type TicketRow } from './schema';
import { readSettings } from './settings';

/**
 * `row` as it was read: `status`, `updated_at` and whether it is in the trash
 * must still be what the route judged, or the statement matches nothing and
 * the batch is `stale`.
 */
export function pinnedTicketWrite(db: Db, row: TicketRow, set: Partial<TicketRow>, at: string, what = `ticket ${row.id}`): AtomicWrite {
  return {
    what,
    statement: db
      .update(ticketTable)
      .set({ ...set, updated_at: at })
      .where(
        and(
          eq(ticketTable.id, row.id),
          eq(ticketTable.status, row.status),
          eq(ticketTable.updated_at, row.updated_at),
          row.trashed_at === null ? isNull(ticketTable.trashed_at) : eq(ticketTable.trashed_at, row.trashed_at),
        ),
      )
      .returning(),
  };
}

export interface NotCommitted {
  /** The subject of the 500's sentence, as in `the edit was rolled back`. */
  rolledBack: string;
  /** The 409 for a stale pin, given the failing statement's `what`. A batch with no pin (inserts only) leaves it out, and a stale answer is then the 500. */
  stale?: (what: string) => Response | Promise<Response>;
}

/** The rows the batch wrote, or the problem response that says why nothing changed. */
export async function commit(c: Context, db: Db, writes: readonly AtomicWrite[], answer: NotCommitted): Promise<unknown[] | Response> {
  try {
    return await atomically(db, writes);
  } catch (error) {
    if (!(error instanceof AtomicWriteError)) throw error;
    if (error.kind === 'stale' && answer.stale) return await answer.stale(error.what);
    return failed(c, `nothing changed — ${answer.rolledBack} (${error.message})`);
  }
}

export async function changedUnderneath(c: Context, db: Db, id: number, doing: string): Promise<Response> {
  const { ticket_prefix } = await readSettings(db);
  return conflict(c, `nothing changed — ticket ${ticketKey(ticket_prefix, id)} changed while ${doing} was being applied; try again`);
}
