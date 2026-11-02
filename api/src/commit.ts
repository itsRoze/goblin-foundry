/**
 * How a route writes a row (ADR-0010): pinned to the version it judged, in
 * one batch with the history that records it, with one answer for a batch
 * that did not commit. `implementation-links.ts` holds a ticket to "still
 * live" rather than to a version.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { ticketKey } from '@goblin/shared';
import { AtomicWriteError, atomically, type AtomicWrite, type Db } from './db';
import { conflict, failed } from './problems';
import { app as appTable, project as projectTable, ticket as ticketTable, type TicketRow } from './schema';
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

type LifecycleTable = typeof appTable | typeof projectTable;
/** What an App or Project row is pinned by, and what a lifecycle move may set on it. */
export interface LifecycleFields {
  archived_at: string | null;
  trashed_at: string | null;
  trashed_via: string | null;
  updated_at: string;
}

/**
 * The same pin for an App or Project row: `updated_at` moves on every write
 * of the row, so with the trash state it covers everything the route judged.
 * `set` may carry the table's own columns too, as a Project's `app_id`.
 */
export function pinnedRowWrite(
  db: Db,
  table: LifecycleTable,
  row: Pick<LifecycleFields, 'updated_at' | 'trashed_at'> & { id: number },
  set: Partial<LifecycleFields> & Record<string, unknown>,
  at: string,
  what: string,
): AtomicWrite {
  return {
    what,
    statement: db
      .update(table)
      .set({ ...set, updated_at: at })
      .where(and(eq(table.id, row.id), eq(table.updated_at, row.updated_at), row.trashed_at === null ? isNull(table.trashed_at) : eq(table.trashed_at, row.trashed_at)))
      .returning(),
  };
}

/**
 * The id of the row a `created` event is about, for a batch that inserts the
 * row first: it is not known until the row is written, so the event names the
 * newest row, which inside the batch's one transaction it is.
 */
export const newestId = (table: LifecycleTable | typeof ticketTable) => sql<number>`(SELECT max(id) FROM ${table})`;

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

/** The 409 for a stale pin, naming the statement's `what` (`ticket GF-7`, `app 3`) and what was being done. */
export const changedWhile = (c: Context, what: string, doing: string) => conflict(c, `nothing changed — ${what} changed while ${doing} was being applied; try again`);

export async function changedUnderneath(c: Context, db: Db, id: number, doing: string): Promise<Response> {
  const { ticket_prefix } = await readSettings(db);
  return changedWhile(c, `ticket ${ticketKey(ticket_prefix, id)}`, doing);
}
