/**
 * A list read's query, the board's Filter among it, turned into a `where`
 * (issue 06). The parsing and the canonical shape belong to `@goblin/shared` —
 * one grammar for the address bar, the wire and `goblin` — and what is here is
 * only the SQL half.
 */
import { asc, eq, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { TERMINAL_STATUSES, parseTicketQuery, type TicketQuery } from '@goblin/shared';
import type { Context } from 'hono';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { unprocessable } from './problems';
import { event as eventTable, ticket as ticketTable, ticketLabel } from './schema';

/** The query these parameters describe, or the 422 the handler returns instead. */
export function readQuery(c: Context): TicketQuery | Response {
  // `query()` keeps only the first of a repeated parameter, and a name dropped here lets its tickets back into a queue
  const parsed = parseTicketQuery({ ...c.req.query(), exclude_label: c.req.queries('exclude_label')?.join(',') });
  return parsed.ok ? parsed.query : unprocessable(c, parsed.issues);
}

/**
 * `%` and `_` are SQLite's wildcards; a human typing `100%` means the
 * character. They are escaped — along with the escape character itself — and
 * the pattern carries its own `ESCAPE` clause. LIKE is already
 * case-insensitive over ASCII, which is the whole of the promise made here.
 */
const contains = (column: SQLiteColumn, text: string): SQL => {
  const pattern = `%${text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
};

/** A Ticket carrying any of these names. They arrive normalised, which is how they are stored. */
const carrying = (names: string[]): SQL => sql`${ticketTable.id} IN (SELECT ${ticketLabel.ticket_id} FROM ${ticketLabel} WHERE ${inArray(ticketLabel.name, names)})`;

/** Every parameter ANDs with the others; a project outside the chosen app simply yields nothing. */
export function ticketWhere(query: TicketQuery): SQL[] {
  const conditions: SQL[] = [];
  for (const [name, column] of [
    ['app_id', ticketTable.app_id],
    ['project_id', ticketTable.project_id],
  ] as const) {
    const value = query[name];
    if (value === undefined) continue;
    conditions.push(value === null ? isNull(column) : eq(column, value));
  }
  if (query.status) conditions.push(inArray(ticketTable.status, query.status));
  // any of them, as a status set is
  if (query.label) conditions.push(carrying(query.label));
  if (query.exclude_label) conditions.push(not(carrying(query.exclude_label)));
  // one condition, so a `q` beside an `app_id` reads as "in this app *and* matching", never as an alternative
  if (query.q !== undefined) conditions.push(or(contains(ticketTable.title, query.q), contains(ticketTable.description, query.q)) as SQL);
  return conditions;
}

/**
 * A Ticket's finish time: the latest Transition into the terminal status it is
 * in now, read from its History. Not `updated_at`, which any edit moves.
 */
const finishing = (column: SQLiteColumn) =>
  sql`(SELECT MAX(${column}) FROM ${eventTable} WHERE ${eventTable.entity_kind} = 'ticket' AND ${eventTable.entity_id} = ${ticketTable.id} AND ${eventTable.kind} = 'transitioned' AND json_extract(${eventTable.new}, '$.status') = ${ticketTable.status})`;

const terminal = inArray(ticketTable.status, [...TERMINAL_STATUSES]);
const whenTerminal = (value: SQL) => sql`CASE WHEN ${terminal} THEN ${value} END DESC`;

/**
 * A list read's order: live Tickets by number, then the finished ones, the most
 * recently finished first. Two finishes in one millisecond fall back on the
 * order History wrote them in.
 */
export const listOrder: SQL[] = [asc(sql`CASE WHEN ${terminal} THEN 1 ELSE 0 END`), whenTerminal(finishing(eventTable.at)), whenTerminal(finishing(eventTable.id)), asc(ticketTable.id)];
