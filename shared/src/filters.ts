/**
 * The board's Filter (CONTEXT.md), as one parser and one serialiser: which
 * Tickets are on the board, written in the address so a bookmarked URL is a
 * saved view. `GET /api/tickets`, `GET /api/frontier`, the web and `goblin`
 * all read and write it here, so a parameter cannot mean one thing in the
 * address bar and another on the wire.
 *
 * Wire names are the API's own — `app_id`, `project_id`, `status`, `q` — and
 * the browser uses them unchanged.
 */
import { TICKET_STATUSES, TicketStatusSchema, type TicketStatus } from './tickets';
import { parseSlugId } from './slug';

export interface TicketFilter {
  app_id?: number | null;
  project_id?: number | null;
  status?: TicketStatus[];
  q?: string;
}

/** The same shape a 422 issue has (ADR-0004), made without zod so `shared` can hand one to the API. */
export interface FilterIssue {
  path: string[];
  message: string;
}

export type ParsedFilter = { ok: true; filter: TicketFilter } | { ok: false; issues: FilterIssue[] };

/** Canonical parameter order: empties are omitted, so equal filters make equal bookmarks. */
export const FILTER_PARAMS = ['app_id', 'project_id', 'status', 'q'] as const;
export type FilterParam = (typeof FILTER_PARAMS)[number];

/**
 * What the board shows when the address names no status set: everything but
 * `cancelled`, which is on the board only when the Filter asks for it
 * (CONTEXT.md "Filter"). The API's own default is every status — a `goblin
 * ticket list` is not a board.
 */
export const DEFAULT_BOARD_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter((s) => s !== 'cancelled');

/** Both shapes a caller has to hand: Hono's `c.req.query()` and the browser's own search params. */
export type FilterSource = URLSearchParams | Record<string, string | undefined>;

const read = (source: FilterSource, name: string): string | undefined =>
  source instanceof URLSearchParams ? (source.get(name) ?? undefined) : source[name];

const ID = /^\d+$/;

export interface ParseOptions {
  /**
   * Accept the `<slug>-<id>` address routes and `goblin` already write. The
   * browser may carry one; the wire never does, so the web strips it here
   * before the request goes out.
   */
  slugs?: boolean;
}

/**
 * Every field is checked, so a pasted address with two mistakes in it is
 * refused once and names both. An absent or empty value is *unset* — a filter
 * on emptiness is not a thing any of these parameters can say.
 */
export function parseTicketFilter(source: FilterSource, { slugs = false }: ParseOptions = {}): ParsedFilter {
  const filter: TicketFilter = {};
  const issues: FilterIssue[] = [];

  for (const name of ['app_id', 'project_id'] as const) {
    const raw = read(source, name)?.trim();
    if (raw === undefined || raw === '') continue;
    const slug = slugs ? parseSlugId(raw) : null;
    if (raw === 'null') filter[name] = null;
    else if (ID.test(raw)) filter[name] = Number(raw);
    else if (slug) filter[name] = slug.id;
    else issues.push({ path: [name], message: 'expected an id or null' });
  }

  const status = read(source, 'status');
  if (status !== undefined) {
    const written = status.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const unknown = written.filter((s) => !TicketStatusSchema.safeParse(s).success);
    if (unknown.length > 0) issues.push({ path: ['status'], message: `${unknown[0]} is not a status` });
    else if (written.length > 0) filter.status = canonicalStatuses(written as TicketStatus[]);
  }

  const q = read(source, 'q')?.trim();
  if (q !== undefined && q !== '') filter.q = q;

  return issues.length > 0 ? { ok: false, issues } : { ok: true, filter };
}

/** Deduped and in lifecycle order, so the set is one string however it was typed. */
export const canonicalStatuses = (statuses: readonly TicketStatus[]): TicketStatus[] =>
  TICKET_STATUSES.filter((s) => statuses.includes(s));

/** The query string, without the `?`; empty when nothing is filtered. */
export function serialiseTicketFilter(filter: TicketFilter): string {
  const params = new URLSearchParams();
  for (const name of ['app_id', 'project_id'] as const) {
    const value = filter[name];
    if (value !== undefined) params.set(name, value === null ? 'null' : String(value));
  }
  if (filter.status && filter.status.length > 0) params.set('status', canonicalStatuses(filter.status).join(','));
  if (filter.q !== undefined && filter.q.trim() !== '') params.set('q', filter.q.trim());
  // a comma is legal unescaped in a query value, and `status=ready,building` is meant to be read
  return params.toString().replaceAll('%2C', ',');
}
