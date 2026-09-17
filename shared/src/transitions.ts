import type { Actor } from './actor';
import { hasDesign } from './design';
import { TICKET_STATUSES, isBlocked, type Ticket, type TicketStatus } from './tickets';

/**
 * The lifecycle as data (ADR-0003). One table, read by the API to validate a
 * move and by the kanban to decide which columns a dragged card may land in,
 * so a controller-owned edge in S5 becomes a refusal in the GUI with no UI
 * change. An edge is addressed by `(from, name)` and that pair is unique.
 */

/** Who may trigger an edge. `controller` arrives with S5; in S1 everything is human-owned. */
export const TRANSITION_OWNERS = ['human', 'controller'] as const;
export type TransitionOwner = (typeof TRANSITION_OWNERS)[number];

/** The verb of an edge. A name has exactly one destination, so a refusal can name where you were heading. */
export const TRANSITION_NAMES = ['pick', 'plan', 'shelve', 'approve', 'unapprove', 'start', 'stop', 'submit', 'ship', 'close', 'cancel', 'reopen'] as const;
export type TransitionName = (typeof TRANSITION_NAMES)[number];

export interface Transition {
  from: TicketStatus;
  to: TicketStatus;
  name: TransitionName;
  owner: TransitionOwner;
  /** The slice the edge arrives in — S1 for all of them; later slices add their own. */
  since: 'S1';
  /** The only guard in S1: what a ticket must have before it may be `ready` or beyond. */
  guard?: 'approve';
}

/** `to` is a property of the name alone, which is what lets a refused drop say where it was going. */
const DESTINATION: Record<TransitionName, TicketStatus> = {
  pick: 'todo',
  plan: 'planning',
  shelve: 'backlog',
  approve: 'ready',
  unapprove: 'planning',
  start: 'building',
  stop: 'ready',
  submit: 'review',
  ship: 'done',
  close: 'done',
  cancel: 'cancelled',
  reopen: 'backlog',
};

/**
 * `start` and `submit` become controller-owned in S5 (ADR-0003); until the
 * controller exists there is nobody else to own them.
 */
const EDGES: { name: TransitionName; from: TicketStatus[]; guard?: 'approve' }[] = [
  { name: 'pick', from: ['backlog', 'planning'] },
  { name: 'plan', from: ['backlog', 'todo'] },
  { name: 'shelve', from: ['todo', 'planning'] },
  { name: 'approve', from: ['todo', 'planning'], guard: 'approve' },
  { name: 'unapprove', from: ['ready'] },
  { name: 'start', from: ['ready'] },
  { name: 'stop', from: ['building'] },
  { name: 'submit', from: ['building'] },
  { name: 'ship', from: ['review'] },
  // `close` records work that turned out to be done as a side effect; deliberately unguarded.
  { name: 'close', from: ['backlog', 'todo', 'planning', 'ready', 'building'] },
  // `cancel` reaches `cancelled` from `done` too — marking something done is a mistake you must be able to take back.
  { name: 'cancel', from: TICKET_STATUSES.filter((s) => s !== 'cancelled') },
  // `reopen`, not `restore`: restoring a ticket is un-trashing it.
  { name: 'reopen', from: ['cancelled'] },
];

export const TRANSITIONS: readonly Transition[] = EDGES.flatMap(({ name, from, guard }) =>
  from.map((f): Transition => ({ from: f, to: DESTINATION[name], name, owner: 'human', since: 'S1', ...(guard ? { guard } : {}) })),
);

export const isTransitionName = (name: string): name is TransitionName => (TRANSITION_NAMES as readonly string[]).includes(name);

/** Where a name leads, whatever the ticket's status — the destination of a move that may not be legal. */
export const destinationOf = (name: TransitionName): TicketStatus => DESTINATION[name];

/** Every edge out of a status, in table order. The state tile's buttons. */
export const transitionsFrom = (from: TicketStatus): Transition[] => TRANSITIONS.filter((t) => t.from === from);

/** The one edge `(from, name)` addresses, or `undefined` when there is none. */
export const findTransition = (from: TicketStatus, name: TransitionName): Transition | undefined => TRANSITIONS.find((t) => t.from === from && t.name === name);

/**
 * The edge a drag describes. `(from, to)` is unique in S1, so dropping a card
 * in a column picks exactly one verb; a slice that adds a second road between
 * two statuses will have to ask which.
 */
export const transitionTo = (from: TicketStatus, to: TicketStatus): Transition | undefined => TRANSITIONS.find((t) => t.from === from && t.to === to);

/** What a named verb asks for: the arrow, or the sentence saying there is none out of here. */
export type KeyedMove = { ok: true; edge: Transition } | { ok: false; refusal: string };

/**
 * The edge a *key* describes (issue 10). A drag names a destination column, so
 * a missing arrow is refused by the pair; a key names the verb, so the refusal
 * is about the arrow that is not there — and both the board's `a` and the
 * Ticket view's `a` have to say the same sentence, which is why the lookup and
 * the refusal are one call rather than the same three lines in two files.
 */
export function keyedMove(from: TicketStatus, name: TransitionName): KeyedMove {
  const edge = findTransition(from, name);
  return edge ? { ok: true, edge } : { ok: false, refusal: structuralRefusal(from, destinationOf(name)) };
}

/**
 * The one place a blocker gets in the way of a move, and it only asks
 * (ADR-0009): `start` is the verb that means "proceeding despite the blocker",
 * so the GUI puts the question to the human. Every other verb goes through
 * without a word, whichever surface triggers it — the board's drop and the
 * state tile's button read this same rule.
 */
export const asksBeforeBlocked = (name: TransitionName, ticket: Pick<Ticket, 'status' | 'blocked_by'>): boolean => name === 'start' && isBlocked(ticket);

/** The only fields the guard looks at — everything that can hold a ticket out of the frontier. */
export type GuardFields = Pick<Ticket, 'app_id' | 'simple' | 'design'>;

/** What the approve guard can find missing (ADR-0003). A description is a field, not a gate. */
export type ApproveRequirement = 'app' | 'design';

const REQUIREMENT_LABEL: Record<ApproveRequirement, string> = { app: 'an app', design: 'a ticket design' };

/** The statuses the guard holds over: `ready` and beyond, not only at the instant of crossing. */
export const GUARDED_STATUSES = ['ready', 'building', 'review'] as const satisfies readonly TicketStatus[];

export const isGuarded = (status: TicketStatus): boolean => (GUARDED_STATUSES as readonly TicketStatus[]).includes(status);

/** The terminal states are earned, never declared — a ticket cannot be created in one. */
export const UNCREATABLE_STATUSES = ['done', 'cancelled'] as const satisfies readonly TicketStatus[];

/** The other six, in lifecycle order: what a create form may offer. */
export const CREATABLE_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter((s) => !(UNCREATABLE_STATUSES as readonly TicketStatus[]).includes(s));

export const isCreatable = (status: TicketStatus): boolean => CREATABLE_STATUSES.includes(status);

/**
 * The single gate into the ready frontier, shared by every client: an app,
 * and a ticket design unless the ticket is simple. Returns what is *missing*,
 * so a refusal can name it; empty means the guard passes.
 */
export function approveGuard(ticket: GuardFields): ApproveRequirement[] {
  const missing: ApproveRequirement[] = [];
  if (ticket.app_id === null) missing.push('app');
  if (!ticket.simple && !hasDesign(ticket.design)) missing.push('design');
  return missing;
}

const list = (missing: ApproveRequirement[]) => missing.map((m) => REQUIREMENT_LABEL[m]).join(' and ');

/**
 * An agent is the hands, never the authority (CONTEXT.md "Actor"): in S1 its
 * reach ends at `planning`. It creates tickets only there, and it owns no
 * edge in the table, so approving what an agent planned is always a human act
 * and the ready frontier is only ever reached by a human's hand. Both halves
 * refuse rather than correct — quietly moving a ticket the planner asked for
 * in `backlog` would hide the misunderstanding instead of naming it.
 */
export const AGENT_CEILING: TicketStatus = 'planning';

/** Where a ticket this actor creates lands when the body names no status. */
export const defaultCreateStatus = (actor: Actor): TicketStatus => (actor === 'agent' ? AGENT_CEILING : 'backlog');

/** Why this actor may not create a ticket *there*, or `null` when it may. */
export const ceilingRefusal = (actor: Actor, status: TicketStatus): string | null =>
  actor === 'agent' && status !== AGENT_CEILING ? `an agent creates a ticket in ${AGENT_CEILING}, never ${status}` : null;

/**
 * Whether the actor holds the authority an edge names. Actors and owners are
 * deliberately different lists: no edge is owned by `agent`, which is the rule
 * rather than an omission, and `controller` becomes an actor in S5.
 */
export const ownsTransition = (actor: Actor, owner: TransitionOwner): boolean => actor === owner;

/** *approve is the human's move, not the agent's* — the refusal about who, where the others are about where (DESIGN.md Components). */
export const ownerRefusal = (name: TransitionName, owner: TransitionOwner, actor: Actor): string => `${name} is the ${owner}'s move, not the ${actor}'s`;

/** *approve needs a ticket design* (DESIGN.md Components). */
export const guardRefusal = (name: TransitionName, missing: ApproveRequirement[]): string => `${name} needs ${list(missing)}`;

/** *a ticket in ready needs an app* — the same sentence when the ticket is standing there rather than walking in. */
export const guardHold = (status: TicketStatus, missing: ApproveRequirement[]): string => `a ticket in ${status} needs ${list(missing)}`;

/** *a ticket in review does not go back to building* — generated from the status pair (DESIGN.md Components). */
export function structuralRefusal(from: TicketStatus, to: TicketStatus): string {
  if (from === to) return `a ticket in ${from} is already in ${to}`;
  const backwards = TICKET_STATUSES.indexOf(to) < TICKET_STATUSES.indexOf(from);
  return `a ticket in ${from} does not go ${backwards ? 'back to' : 'to'} ${to}`;
}

/** What asking for a named move comes to: the arrow to take, or the one sentence saying why not and whose arrow it was. */
export type JudgedTransition = { ok: true; edge: Transition } | { ok: false; reason: string; owner: TransitionOwner };

/**
 * The whole of what stands between a Ticket and a named move, in the order the
 * refusals are owed (ADR-0003): is there such an arrow out of here, does this
 * actor own it, does the Ticket have what the arrow's guard wants. Authority
 * comes before requirements — an actor who owns no edge here is not told what
 * the Ticket is missing. One Ticket or a batch of them, the API asks this; the
 * board asks it too before sending a Selection, so a refusal it can see coming
 * is said in the same words without a round trip.
 */
export function judgeTransition(ticket: GuardFields & Pick<Ticket, 'status'>, name: TransitionName, actor: Actor): JudgedTransition {
  const edge = findTransition(ticket.status, name);
  if (!edge) return { ok: false, reason: structuralRefusal(ticket.status, destinationOf(name)), owner: 'human' };
  if (!ownsTransition(actor, edge.owner)) return { ok: false, reason: ownerRefusal(name, edge.owner, actor), owner: edge.owner };
  const lacks = edge.guard ? approveGuard(ticket) : [];
  if (lacks.length > 0) return { ok: false, reason: guardRefusal(name, lacks), owner: edge.owner };
  return { ok: true, edge };
}

/** History reads as decisions, not only as state (ADR-0003) — the verb, in the past, beside the table it comes from. */
export const TRANSITION_PAST: Record<TransitionName, string> = {
  pick: 'picked',
  plan: 'planned',
  shelve: 'shelved',
  approve: 'approved',
  unapprove: 'unapproved',
  start: 'started',
  stop: 'stopped',
  submit: 'submitted',
  ship: 'shipped',
  close: 'closed',
  cancel: 'cancelled',
  reopen: 'reopened',
};
