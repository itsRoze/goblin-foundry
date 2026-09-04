/**
 * The board's Filter, turned into a `where` (issue 06). The parsing and the
 * canonical shape belong to `@goblin/shared` — one grammar for the address
 * bar, the wire and `goblin` — and what is here is only the SQL half.
 */
import { eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { parseTicketFilter, type TicketFilter } from '@goblin/shared';
import type { Context } from 'hono';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { unprocessable } from './problems';
import { ticket as ticketTable } from './schema';

/** The filter these parameters describe, or the 422 the handler returns instead. */
export function readFilter(c: Context): TicketFilter | Response {
  const parsed = parseTicketFilter(c.req.query());
  return parsed.ok ? parsed.filter : unprocessable(c, parsed.issues);
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

/** Every parameter ANDs with the others; a project outside the chosen app simply yields nothing. */
export function ticketWhere(filter: TicketFilter): SQL[] {
  const conditions: SQL[] = [];
  for (const [name, column] of [
    ['app_id', ticketTable.app_id],
    ['project_id', ticketTable.project_id],
  ] as const) {
    const value = filter[name];
    if (value === undefined) continue;
    conditions.push(value === null ? isNull(column) : eq(column, value));
  }
  if (filter.status) conditions.push(inArray(ticketTable.status, filter.status));
  // one condition, so a `q` beside an `app_id` reads as "in this app *and* matching", never as an alternative
  if (filter.q !== undefined) conditions.push(or(contains(ticketTable.title, filter.q), contains(ticketTable.description, filter.q)) as SQL);
  return conditions;
}
