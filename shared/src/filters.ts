/**
 * The board's Filter (GLOSSARY.md), parsed and serialised in one place: which
 * Tickets are on the board, written in the address so a bookmarked URL is a
 * saved view. `GET /api/tickets`, `GET /api/frontier`, the web and `goblin`
 * all read and write it here, so a parameter cannot mean one thing in the
 * address bar and another on the wire.
 *
 * Wire names are the API's own — `app_id`, `project_id`, `status`, `label`,
 * `q` — and the browser uses them unchanged. The two endpoints and `goblin`
 * read a little more than the Filter; see `TicketQuery`.
 */
import { splitLabels, ticketLabels } from './labels';
import { TICKET_STATUSES, TicketStatusSchema, type TicketStatus } from './tickets';
import { parseSlugId } from './slug';

export interface TicketFilter {
  app_id?: number | null;
  project_id?: number | null;
  status?: TicketStatus[];
  /** Any of these Labels (ADR-0013), the way `status` is any of those statuses. */
  label?: string[];
  q?: string;
}

/** The same shape a 422 issue has (ADR-0004), made without zod so `shared` can hand one to the API. */
export interface FilterIssue {
  path: string[];
  message: string;
}

export type ParsedFilter = { ok: true; filter: TicketFilter } | { ok: false; issues: FilterIssue[] };

/**
 * What the two list endpoints read: the board's Filter, and what a queue needs
 * beyond it. The board does not take `exclude_label`, so it is not on
 * `TicketFilter` or in `FILTER_PARAMS`: `parseTicketFilter` never sees it, and
 * a bookmarked address that names it means nothing.
 */
export interface TicketQuery extends TicketFilter {
  /** None of these Labels: a Ticket carrying any of them is left out. */
  exclude_label?: string[];
}

export type ParsedQuery = { ok: true; query: TicketQuery } | { ok: false; issues: FilterIssue[] };

export type QueryParam = FilterParam | 'exclude_label';

/** Canonical parameter order: empties are omitted, so equal filters make equal bookmarks. */
export const FILTER_PARAMS = ['app_id', 'project_id', 'status', 'label', 'q'] as const;
export type FilterParam = (typeof FILTER_PARAMS)[number];

/**
 * What the board shows when the address names no status set: everything but
 * `cancelled`, which is on the board only when the Filter asks for it
 * (GLOSSARY.md "Filter"). The API's own default is every status — a `goblin
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

  const label = readLabels(source, 'label', issues);
  if (label) filter.label = label;

  const q = read(source, 'q')?.trim();
  if (q !== undefined && q !== '') filter.q = q;

  return issues.length > 0 ? { ok: false, issues } : { ok: true, filter };
}

/** The Filter's parser and the one parameter it does not read, refused together as the Filter's own are. */
export function parseTicketQuery(source: FilterSource): ParsedQuery {
  const parsed = parseTicketFilter(source);
  const issues = parsed.ok ? [] : [...parsed.issues];
  const exclude_label = readLabels(source, 'exclude_label', issues);
  if (!parsed.ok || issues.length > 0) return { ok: false, issues };
  return { ok: true, query: exclude_label ? { ...parsed.filter, exclude_label } : parsed.filter };
}

/** A set of names, or nothing when it is unset or refused; a refusal goes on `issues`. */
function readLabels(source: FilterSource, name: Extract<QueryParam, 'label' | 'exclude_label'>, issues: FilterIssue[]): string[] | undefined {
  const written = read(source, name);
  if (written === undefined) return undefined;
  // the Piece's own judgement, so a name refused here is one a Ticket could never carry
  const judged = ticketLabels.judge(splitLabels(written));
  if (!judged.ok) {
    issues.push({ path: [name], message: judged.refusal });
    return undefined;
  }
  return judged.labels.length > 0 ? canonicalLabels(judged.labels) : undefined;
}

/** Deduped and in lifecycle order, so the set is one string however it was typed. */
export const canonicalStatuses = (statuses: readonly TicketStatus[]): TicketStatus[] =>
  TICKET_STATUSES.filter((s) => statuses.includes(s));

/**
 * Deduped and sorted: a label set has no lifecycle to be ordered by, so it is
 * ordered by name. The names are already as the Piece writes them — judged by
 * the parser, or read off a Ticket — so they are not normalised again.
 */
export const canonicalLabels = (labels: readonly string[]): string[] => [...new Set(labels)].sort();

/** The query string, without the `?`; empty when nothing is filtered. */
export const serialiseTicketFilter = (filter: TicketFilter): string => queryString(filterParams(filter));

/** The same for a `TicketQuery`; `exclude_label` comes last, after the Filter's own order. */
export function serialiseTicketQuery({ exclude_label, ...filter }: TicketQuery): string {
  const params = filterParams(filter);
  if (exclude_label && exclude_label.length > 0) params.set('exclude_label', canonicalLabels(exclude_label).join(','));
  return queryString(params);
}

function filterParams(filter: TicketFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of ['app_id', 'project_id'] as const) {
    const value = filter[name];
    if (value !== undefined) params.set(name, value === null ? 'null' : String(value));
  }
  if (filter.status && filter.status.length > 0) params.set('status', canonicalStatuses(filter.status).join(','));
  if (filter.label && filter.label.length > 0) params.set('label', canonicalLabels(filter.label).join(','));
  if (filter.q !== undefined && filter.q.trim() !== '') params.set('q', filter.q.trim());
  return params;
}

// a comma and a colon are legal unescaped in a query value, and `label=needs-info,wayfinder:research` is meant to be read
const queryString = (params: URLSearchParams): string => params.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
