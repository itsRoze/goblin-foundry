/**
 * How a route writes a Ticket (ADR-0010): the row pinned to the version it
 * judged, committed in one batch with the history that records it, and one
 * answer for a batch that did not commit. Every route that writes a Ticket
 * builds its update here, so none can overwrite a row it did not read.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { AtomicWriteError, atomically, type AtomicWrite, type Db } from './db';
import { conflict, failed } from './problems';
import { ticket as ticketTable, type TicketRow } from './schema';

/**
 * `row` as it was read: `status`, `updated_at` and whether it is in the trash
 * must still be what the route judged, or the statement matches nothing and
 * the batch is `stale`. The statement returns the whole written row.
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

/** What a route says when its batch did not commit. */
export interface Refusals {
  /** The subject of the 500: `the edit was rolled back`. */
  rolledBack: string;
  /** The 409 for a stale pin, given the failing statement's `what`. */
  stale: (what: string) => Response | Promise<Response>;
}

/**
 * The rows the batch wrote, or the problem response that says why nothing
 * changed: a `fault` (the driver refused a write) is a 500, and a `stale` pin
 * (the row moved between the read and the commit) is the 409 the route spells out.
 */
export async function commit(c: Context, db: Db, writes: readonly AtomicWrite[], refusals: Refusals): Promise<unknown[] | Response> {
  try {
    return await atomically(db, writes);
  } catch (error) {
    if (!(error instanceof AtomicWriteError)) throw error;
    if (error.kind === 'fault') return failed(c, `nothing changed — ${refusals.rolledBack} (${error.message})`);
    return await refusals.stale(error.what);
  }
}

/** The 409 a single-Ticket route gives a stale pin: which ticket, and what was being applied to it. */
export const changedUnderneath = (c: Context, key: string, verb: string) => conflict(c, `nothing changed — ticket ${key} changed while ${verb} was being applied; try again`);
