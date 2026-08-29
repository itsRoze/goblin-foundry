import { TICKET_STATUSES, type Ticket, type TicketStatus } from './tickets';

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

/**
 * The single gate into the ready frontier, shared by every client: an app,
 * and a ticket design unless the ticket is simple. Returns what is *missing*,
 * so a refusal can name it; empty means the guard passes.
 */
export function approveGuard(ticket: GuardFields): ApproveRequirement[] {
  const missing: ApproveRequirement[] = [];
  if (ticket.app_id === null) missing.push('app');
  if (!ticket.simple && (ticket.design ?? '').trim() === '') missing.push('design');
  return missing;
}

const list = (missing: ApproveRequirement[]) => missing.map((m) => REQUIREMENT_LABEL[m]).join(' and ');

/** *approve needs a ticket design* (DESIGN.md §6). */
export const guardRefusal = (name: TransitionName, missing: ApproveRequirement[]): string => `${name} needs ${list(missing)}`;

/** *a ticket in ready needs an app* — the same sentence when the ticket is standing there rather than walking in. */
export const guardHold = (status: TicketStatus, missing: ApproveRequirement[]): string => `a ticket in ${status} needs ${list(missing)}`;

/** *a ticket in review does not go back to building* — generated from the status pair (DESIGN.md §6). */
export function structuralRefusal(from: TicketStatus, to: TicketStatus): string {
  if (from === to) return `a ticket in ${from} is already in ${to}`;
  const backwards = TICKET_STATUSES.indexOf(to) < TICKET_STATUSES.indexOf(from);
  return `a ticket in ${from} does not go ${backwards ? 'back to' : 'to'} ${to}`;
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
