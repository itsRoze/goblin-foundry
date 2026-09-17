import { TRANSITION_PAST, asksBeforeBlocked, hasDesign, judgeTransition, transitionsFrom, type BulkAction, type BulkRefusal, type Ticket, type TransitionName } from '@goblin/shared';
import { rankedMoves } from './palette';

/**
 * What a bulk action says and asks, as data (issue 03b). The provider sends
 * it and the board draws it; this is the half with no browser in it — which
 * verbs a whole Selection shares, what can be refused without a round trip,
 * and the one question each action may have to ask first.
 */

/** What the board knows about a member: enough to judge a move, ask about blockers and name it. */
export type Member = Pick<Ticket, 'id' | 'key' | 'status' | 'app_id' | 'simple' | 'design' | 'blocked_by'>;

const PRESENT: Record<TransitionName, string> = {
  pick: 'Picking',
  plan: 'Planning',
  shelve: 'Shelving',
  approve: 'Approving',
  unapprove: 'Unapproving',
  start: 'Starting',
  stop: 'Stopping',
  submit: 'Submitting',
  ship: 'Shipping',
  close: 'Closing',
  cancel: 'Cancelling',
  reopen: 'Reopening',
};

/** *Approved*: the shared table's own past tense (the history's), with a capital because it opens the sentence. */
const past = (name: TransitionName): string => TRANSITION_PAST[name].charAt(0).toUpperCase() + TRANSITION_PAST[name].slice(1);

export const countOf = (n: number): string => `${n} Ticket${n === 1 ? '' : 's'}`;

/** *Approving 10 Tickets…* while it is out, *Approved 10 Tickets* once it is back — an action and a count, never a progress bar. */
export function bulkLabel(action: BulkAction, n: number, tense: 'pending' | 'done'): string {
  const pending = tense === 'pending';
  const verb = action.kind === 'transition' ? (pending ? PRESENT[action.name] : past(action.name)) : action.kind === 'move' ? (pending ? 'Moving' : 'Moved') : pending ? 'Trashing' : 'Trashed';
  return `${verb} ${countOf(n)}${tense === 'pending' ? '…' : ''}`;
}

/**
 * The verbs every member has an arrow for — the same *name*, whatever status
 * each starts from; sharing a destination is not enough. Ranked as the first
 * member's menu ranks them.
 */
export function commonMoves(members: readonly Pick<Ticket, 'status'>[]): TransitionName[] {
  const [first, ...rest] = members;
  if (!first) return [];
  return rankedMoves(first.status).filter((name) => rest.every((t) => transitionsFrom(t.status).some((edge) => edge.name === name)));
}

/**
 * What can be refused before asking the API: a transition judged against the
 * shared table and guard, for the human at this screen. The API judges again
 * and its word is final; this only spares the round trip for what is already
 * plain. Moves and trash have nothing to check from here.
 */
export function preflight(action: BulkAction, members: readonly Member[]): BulkRefusal[] {
  if (action.kind !== 'transition') return [];
  return members.flatMap((t) => {
    const judged = judgeTransition(t, action.name, 'human');
    return judged.ok ? [] : [{ key: t.key, reason: judged.reason }];
  });
}

/** The one question an action asks before it goes: what it is about, line by line, and the word on the button. */
export interface Question {
  text: string;
  lines: string[];
  verb: string;
  /** Only an ending wears `--gf-human`; `start … anyway` is a go-ahead, like the single Ticket's (DESIGN.md Colors, one job). */
  danger: boolean;
}

/** How many keys a question spells out before it counts the rest: the set may be a whole board. */
const NAMED = 12;

const namesOf = (members: readonly Member[]): string =>
  members.length <= NAMED ? members.map((t) => t.key).join(' ') : `${members.slice(0, NAMED).map((t) => t.key).join(' ')} and ${members.length - NAMED} more`;

/**
 * Trash asks once, with the whole count — folded Tickets included, because the
 * count is of the Selection, not of what is on screen, which is also why it
 * names them: some may be a fold or a screen away. It says the trash is the
 * undo, because that is what makes a yes cheap (PRODUCT.md principle 3). `start` asks once when
 * any member still has an open blocker, naming each and what blocks it
 * (ADR-0009: a blocker never forbids, the board asks). Nothing else asks.
 */
export function questionFor(action: BulkAction, members: readonly Member[]): Question | null {
  if (action.kind === 'trash') return { text: `Trash ${countOf(members.length)}?`, lines: [namesOf(members), 'each can be restored from the trash'], verb: 'trash', danger: true };
  if (action.kind !== 'transition') return null;
  const blocked = members.filter((t) => asksBeforeBlocked(action.name, t));
  if (blocked.length === 0) return null;
  return {
    text: `${countOf(blocked.length)} of ${members.length} still ${blocked.length === 1 ? 'has' : 'have'} open blockers`,
    lines: blocked.map((t) => `${t.key} is blocked by ${t.blocked_by.join(', ')}`),
    verb: `start ${countOf(members.length)} anyway`,
    danger: false,
  };
}

/**
 * What a confirmation is bound to: exactly these Tickets. A different set
 * dismisses the question outright.
 */
export const setSignature = (members: readonly Member[]): string => members.map((t) => t.id).join(',');

/** …and what makes its answer stale without changing the set: a status or a blocker. A retitled Ticket changes neither. */
export const eligibilitySignature = (members: readonly Member[]): string => members.map((t) => `${t.id}:${t.status}:${t.app_id}:${t.simple}:${hasDesign(t.design)}:${t.blocked_by.join('+')}`).join(',');
