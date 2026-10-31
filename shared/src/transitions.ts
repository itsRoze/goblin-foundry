import { defineWorkflow, type EdgeOf, type NameOf } from '@goblin/workflow';
import type { Actor } from './actor';
import { hasDesign } from './design';
import { TICKET_STATUSES, isBlocked, type Ticket, type TicketStatus } from './tickets';

export type GuardFields = Pick<Ticket, 'app_id' | 'simple' | 'design'>;

export type ApproveRequirement = 'app' | 'design';

const REQUIREMENT_LABEL: Record<ApproveRequirement, string> = { app: 'an app', design: 'a ticket design' };

export function approveGuard(ticket: GuardFields): ApproveRequirement[] {
  const missing: ApproveRequirement[] = [];
  if (ticket.app_id === null) missing.push('app');
  if (!ticket.simple && !hasDesign(ticket.design)) missing.push('design');
  return missing;
}

export const lifecycle = defineWorkflow({
  noun: 'ticket',
  statuses: TICKET_STATUSES,
  // Actor is a record, never a permission (ADR-0012): each holds the other's
  // authority, so the owner the Piece asks of every row decides nothing here.
  actors: { human: ['human', 'agent'], agent: ['agent', 'human'] } as const satisfies Record<Actor, readonly Actor[]>,
  transitions: {
    pick: { from: ['backlog', 'planning'], to: 'todo', owner: 'human' },
    plan: { from: ['backlog', 'todo'], to: 'planning', owner: 'human' },
    shelve: { from: ['todo', 'planning'], to: 'backlog', owner: 'human' },
    approve: { from: ['todo', 'planning'], to: 'ready', owner: 'human' },
    unapprove: { from: ['ready'], to: 'planning', owner: 'human' },
    start: { from: ['ready'], to: 'building', owner: 'human' },
    stop: { from: ['building'], to: 'ready', owner: 'human' },
    submit: { from: ['building'], to: 'review', owner: 'human' },
    ship: { from: ['review'], to: 'done', owner: 'human' },
    close: { from: ['backlog', 'todo', 'planning', 'ready', 'building'], to: 'done', owner: 'human' },
    cancel: { from: TICKET_STATUSES.filter((s) => s !== 'cancelled'), to: 'cancelled', owner: 'human' },
    reopen: { from: ['cancelled'], to: 'backlog', owner: 'human' },
  },
  requires: {
    in: ['ready', 'building', 'review'],
    missing: approveGuard,
    label: (missing) => REQUIREMENT_LABEL[missing],
  },
});

export type TransitionName = NameOf<typeof lifecycle>;
export type Transition = EdgeOf<typeof lifecycle>;
export type { Found } from '@goblin/workflow';

/**
 * The one place a blocker gets in the way of a move, and it only asks
 * (ADR-0009): `start` is the verb that means "proceeding despite the blocker",
 * so the GUI puts the question to the human. Every other verb goes through
 * without a word, whichever surface triggers it — the board's drop and the
 * state tile's button read this same rule.
 */
export const asksBeforeBlocked = (name: TransitionName, ticket: Pick<Ticket, 'status' | 'blocked_by'>): boolean => name === 'start' && isBlocked(ticket);

export const guardHold = (status: TicketStatus, missing: readonly ApproveRequirement[]): string => `a ticket in ${status} needs ${missing.map((m) => REQUIREMENT_LABEL[m]).join(' and ')}`;

/** The terminal states are earned, never declared — a ticket cannot be created in one. */
export const UNCREATABLE_STATUSES = ['done', 'cancelled'] as const satisfies readonly TicketStatus[];

/** The other six, in lifecycle order: what a create form may offer. */
export const CREATABLE_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter((s) => !(UNCREATABLE_STATUSES as readonly TicketStatus[]).includes(s));

export const isCreatable = (status: TicketStatus): boolean => CREATABLE_STATUSES.includes(status);

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
