/**
 * Archived, for a Ticket (GLOSSARY.md, ADR-0015): worked out on every read
 * from its History and the clock, never stored. Nothing on a timer writes it,
 * so there is no third Actor to blame for a Ticket leaving the board.
 */
import { getTableName, inArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { TERMINAL_STATUSES, archiveCutoff, archivedAt } from '@goblin/shared';
import type { Db } from './db';
import { batches } from './dependencies';
import { event as eventTable, ticket as ticketTable, type TicketRow } from './schema';

/** Always `table.column`: Drizzle leaves a single-table selection unqualified, and inside the subquery a bare `id` is the event's. */
const qualified = (column: SQLiteColumn) => sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

/**
 * The later of a Ticket's finish time — the latest Transition into the
 * terminal status it is in now — and its last `unarchive`: the moment its
 * month runs from. An edit moves neither.
 */
export const archiveClock = (t: { id: SQLiteColumn; status: SQLiteColumn } = ticketTable) =>
  sql<string | null>`(SELECT MAX(${eventTable.at}) FROM ${eventTable} WHERE ${eventTable.entity_kind} = 'ticket' AND ${eventTable.entity_id} = ${qualified(t.id)} AND ((${eventTable.kind} = 'transitioned' AND json_extract(${eventTable.new}, '$.status') = ${qualified(t.status)}) OR ${eventTable.kind} = 'unarchived'))`;

/** Archived at `now`. `COALESCE`, because a finished Ticket with no recorded finish has no clock and stays on the board. */
export const archivedWhere = (now: number, t: { id: SQLiteColumn; status: SQLiteColumn } = ticketTable): SQL =>
  sql`(${inArray(t.status, [...TERMINAL_STATUSES])} AND COALESCE(${archiveClock(t)} < ${archiveCutoff(now)}, 0))`;

/** `archived_at` for each of these Tickets, by id, at `now`; batched, per ADR-0001. */
export async function archivedAtOf(db: Db, rows: readonly Pick<TicketRow, 'id'>[], now = Date.now()): Promise<Map<number, string | null>> {
  const archived = new Map<number, string | null>();
  for (const batch of batches(rows.map((row) => row.id)))
    for (const row of await db.select({ id: ticketTable.id, status: ticketTable.status, clock: archiveClock() }).from(ticketTable).where(inArray(ticketTable.id, batch)))
      archived.set(row.id, archivedAt(row.status, row.clock, now));
  return archived;
}
