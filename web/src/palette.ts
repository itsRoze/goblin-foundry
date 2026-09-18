import { TICKET_STATUSES, destinationOf, parseTicketKey, transitionsFrom, type BulkAction, type TicketStatus, type TransitionName } from '@goblin/shared';

/**
 * What `⌘K` offers, as data. The view builds the candidates (it is the half
 * that knows which tickets are live and which app you are standing in) and
 * performs the actions; this module holds the vocabulary and the ranking.
 *
 * The ranking is the whole of what makes a palette usable — the ticket whose
 * key you typed has to be the first row, not the fourth — and none of it needs
 * a browser, so it is pure and tested as such.
 */

/**
 * Fixed order, so a row never moves under a keystroke: the thing you are most
 * likely naming, then what can be done to the Ticket in hand, then where to
 * go, then what to make. `board` is the fifth because "clear filters" needed a
 * home; anything else the board can be told from a distance joins it.
 */
export const PALETTE_GROUPS = ['tickets', 'actions', 'go to', 'create', 'board'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** A palette that scrolls is a list; eight rows is what stays a menu. */
export const PALETTE_ROWS = 8;

/** The three things a `+` or `c` makes; the palette reaches the same forms by name. */
export type CreateWhat = 'ticket' | 'app' | 'project';

/**
 * What choosing a row does. A union rather than a closure so the candidates
 * stay comparable data: the palette never invents an act the screen behind it
 * does not already have a button for.
 */
export type PaletteAction =
  /** A ticket, a page, an app or a project — everything that is somewhere to be. */
  | { kind: 'go'; to: string }
  | { kind: 'move'; name: TransitionName }
  | { kind: 'trash' }
  | { kind: 'simple'; simple: boolean }
  /** `d`: the dependencies tile's `blocked by` picker, wherever you pressed it from. */
  | { kind: 'blocked-by' }
  /** One step of a nested pick: the palette re-opens listing the live apps or projects. */
  | { kind: 'nest'; into: 'app' | 'project' }
  | { kind: 'place'; field: 'app_id' | 'project_id'; id: number | null }
  /** One action on the whole Selection (issue 03b) — the only kind offered while there is one. */
  | { kind: 'bulk'; action: BulkAction }
  | { kind: 'create'; what: CreateWhat }
  | { kind: 'clear-filters' };

export interface Candidate {
  /** Stable within one list — the react key and the test handle. */
  id: string;
  group: PaletteGroup;
  /** What the row says, and the first thing a query is matched against. */
  label: string;
  /** A ticket's key: searched alongside the label, and matched *exactly* to lift the row to the top. */
  key?: string;
  /** The right-hand note — where a transition lands, what kind of thing a `go to` row is. */
  note?: string;
  /** A Ticket's own status, drawn as a chip; a transition's destination is a note, not a state. */
  status?: TicketStatus;
  /** A `done`/`cancelled` ticket: still offered, always after the open ones (the Ticket picker's rule). */
  inert?: boolean;
  action: PaletteAction;
}

/** `GF-12` and a bare `12` both name ticket 12 — the number is the identity (ADR-0002). */
function namesExactly(key: string, needle: string): boolean {
  if (key.toLowerCase() === needle) return true;
  const asked = parseTicketKey(needle);
  return asked !== null && parseTicketKey(key) === asked && /^\d+$/.test(needle);
}

const matches = (c: Candidate, needle: string) =>
  c.label.toLowerCase().includes(needle) || (c.key !== undefined && c.key.toLowerCase().includes(needle));

/**
 * The rows for a query. An empty one shows everything but the tickets —
 * every ticket is not a menu — and any other is a case-insensitive substring
 * of a label or a key. Order is the group order, then, inside `tickets`, the
 * key you typed exactly, then the open ones, then the settled ones; every
 * other group keeps the order it was built in, which is the order its buttons
 * sit in on screen.
 *
 * The cap is shared out differently in the two cases, because the two
 * questions are different. With a query you named something, so the ranking
 * above is the answer and the cap simply takes the top of it. With no query
 * you are reading a menu, and `actions` alone is nine or ten rows on a Ticket
 * — enough to bury `go to` and `create` entirely — so the rows go round the
 * groups one at a time and every group present is on screen.
 */
export function paletteHits(all: Candidate[], query: string): Candidate[] {
  const needle = query.trim().toLowerCase();
  const hits = all.filter((c) => (needle === '' ? c.group !== 'tickets' : matches(c, needle)));
  const rank = (c: Candidate) => {
    if (c.group !== 'tickets') return 0;
    if (c.key !== undefined && namesExactly(c.key, needle)) return -1;
    return c.inert ? 1 : 0;
  };
  const ordered = hits
    .map((c, i) => ({ c, i }))
    .sort((a, b) => PALETTE_GROUPS.indexOf(a.c.group) - PALETTE_GROUPS.indexOf(b.c.group) || rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
  return needle === '' ? shareOut(ordered) : ordered.slice(0, PALETTE_ROWS);
}

/** One row per group, round and round, until the cap runs out — so no group is crowded out by the one above it. */
function shareOut(ordered: Candidate[]): Candidate[] {
  const queues = PALETTE_GROUPS.map((group) => ordered.filter((c) => c.group === group)).filter((q) => q.length > 0);
  const taken: Candidate[] = [];
  for (let round = 0; taken.length < PALETTE_ROWS && queues.some((q) => q.length > round); round += 1)
    for (const queue of queues) {
      if (taken.length === PALETTE_ROWS) break;
      if (queue[round] !== undefined) taken.push(queue[round]!);
    }
  // back into group order: the rounds interleave them, and the groups are what the labels divide
  return taken.sort((a, b) => PALETTE_GROUPS.indexOf(a.group) - PALETTE_GROUPS.indexOf(b.group) || ordered.indexOf(a) - ordered.indexOf(b));
}

/**
 * The verbs out of a status ranked by what you probably meant: the moves that
 * carry the Ticket *forward* first, the ones that send it back after, and
 * `cancel` last. The state tile keeps the table's order; a menu ranks (issue
 * 10), and the card's `⋯` reads the same ranking (issue 11). Out of `ready`
 * that is `start` first rather than `unapprove`.
 */
export function rankedMoves(from: TicketStatus): TransitionName[] {
  const direction = (name: TransitionName) =>
    name === 'cancel' ? 2 : TICKET_STATUSES.indexOf(destinationOf(name)) < TICKET_STATUSES.indexOf(from) ? 1 : 0;
  return transitionsFrom(from)
    .map((edge) => edge.name)
    .sort((a, b) => direction(a) - direction(b));
}

export function transitionRows(from: TicketStatus): Candidate[] {
  return rankedMoves(from).map((name) => ({ id: `move-${name}`, group: 'actions', label: name, note: destinationOf(name), action: { kind: 'move', name } }));
}

const bulkMove = (name: TransitionName): Candidate => ({ id: `move-${name}`, group: 'actions', label: name, note: destinationOf(name), action: { kind: 'bulk', action: { kind: 'transition', name } } });

/** `s` with a Selection: the verbs every member shares (`commonMoves`), each addressed to the whole set. */
export const selectionTransitionRows = (shared: readonly TransitionName[]): Candidate[] => shared.map(bulkMove);

/**
 * Where a Selection can be sent. The two removals are rows of their own rather
 * than a `no app` inside a nested pick: *remove from project* keeps each
 * Ticket's App and *remove app and project* does not, and that difference has
 * to be readable before it is chosen.
 */
export function selectionMoveRows(): Candidate[] {
  return [
    { id: 'act-move-app', group: 'actions', label: 'move to app…', action: { kind: 'nest', into: 'app' } },
    { id: 'act-move-project', group: 'actions', label: 'move to project…', action: { kind: 'nest', into: 'project' } },
    { id: 'act-no-project', group: 'actions', label: 'remove from project', note: 'keeps the app', action: { kind: 'bulk', action: { kind: 'move', to: { kind: 'no-project' } } } },
    { id: 'act-nowhere', group: 'actions', label: 'remove app and project', action: { kind: 'bulk', action: { kind: 'move', to: { kind: 'nowhere' } } } },
  ];
}

/**
 * Everything the palette does to a Selection: transitions, moves and trash,
 * and nothing else. `simple` and `blocked by…` are gone on purpose — they are
 * about one Ticket, and a row that quietly meant the Cursor's would edit a
 * Ticket nobody ticked.
 */
export function selectionRows(shared: readonly TransitionName[]): Candidate[] {
  return [...selectionTransitionRows(shared), { id: 'act-trash', group: 'actions', label: 'trash', action: { kind: 'bulk', action: { kind: 'trash' } } }, ...selectionMoveRows()];
}

/** The second step of a bulk `move to…`: every live target — a Project brings its App, so none is ruled out by where the Tickets are now. */
export function selectionPlaceRows(into: 'app' | 'project', targets: readonly { id: number; name: string }[] | undefined): Candidate[] {
  return (targets ?? []).map((t): Candidate => ({ id: `place-${t.id}`, group: 'actions', label: t.name, action: { kind: 'bulk', action: { kind: 'move', to: { kind: into, id: t.id } } } }));
}
