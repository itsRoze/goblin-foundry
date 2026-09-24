import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BulkAction, TransitionName } from '@goblin/shared';
import type { Member } from './bulk';

/**
 * The current Ticket, and what this screen can do to it (CONTEXT.md
 * "Cursor"): the open Ticket on a Ticket view, otherwise the Ticket under the
 * Cursor. Two screens supply one — the board and the Ticket view — and they
 * supply the *same* verbs, wired to the same mutations their own buttons use.
 *
 * That is the whole point of the seam. `a`, `s`, `d` and every `⌘K` action go
 * through it, so a key can never do more than the button beside it, and each
 * screen still files its refusals in the slot its own button uses (DESIGN.md
 * Components: a refusal is placed where the action was refused).
 */
export interface TicketActions {
  key: string;
  /** One named transition, refused locally when the table has no such arrow out of here. */
  move: (name: TransitionName) => void;
  trash: () => void;
  simple: (simple: boolean) => void;
  /** `d`: open the `blocked by` picker — on the Ticket view, or on the way to it. */
  blockedBy: () => void;
  copyBranch: () => void;
  addImplementationLink: () => void;
  /** `move to app…` / `move to project…`, ADR-0007 applied as the Ticket view's selects apply it. */
  place: (field: 'app_id' | 'project_id', id: number | null) => void;
}

/**
 * What the board offers instead while a Selection exists (issue 03b): the
 * three bulk actions, addressed to the whole set. While there is one, `a`, `s`
 * and the palette reach for this and never for the Cursor's Ticket — a key
 * that silently meant one card while twelve were ticked would be the worst
 * kind of surprise. Only the board offers it, so a Ticket view keeps its own
 * target whatever is selected behind it.
 */
export interface SelectionActions {
  members: readonly Member[];
  act: (action: BulkAction) => void;
  /** `d`: dependencies are declared from one Ticket; say so rather than guess which. */
  explainDependencies: () => void;
}

interface Current {
  /** The key, in state, so the palette re-renders when the cursor moves. */
  key: string | null;
  /** The verbs, in a ref, so a key handler always reaches this render's without re-binding. */
  actions: { current: TicketActions | null };
  /** The Selection's members, in state, so the palette redraws when one of them changes as well as when the count does; empty is "no Selection". */
  members: readonly Member[];
  /** The Selection's verbs, in a ref, for the same reason the Ticket's are. */
  selectionActions: { current: SelectionActions | null };
}

const NO_MEMBERS: readonly Member[] = [];

const CurrentContext = createContext<(Current & { set: (key: string | null) => void; setMembers: (members: readonly Member[]) => void }) | null>(null);

export function CurrentTicketProvider({ children }: { children: ReactNode }) {
  const actions = useRef<TicketActions | null>(null);
  const selectionActions = useRef<SelectionActions | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [members, setMembers] = useState<readonly Member[]>(NO_MEMBERS);
  const value = useMemo(() => ({ key, actions, set: setKey, members, selectionActions, setMembers }), [key, members]);
  return <CurrentContext.Provider value={value}>{children}</CurrentContext.Provider>;
}

function useCurrentContext() {
  const current = useContext(CurrentContext);
  if (current === null) throw new Error('the current ticket outside the shell');
  return current;
}

/**
 * The screen says which Ticket is current and what it can do to it, or `null`
 * when there is none — the board with no Cursor, every other page. Keys that
 * act on a Ticket simply do nothing when nothing has been offered, which is
 * how "`a s d` on the board and the Ticket view only" is enforced in one place.
 */
export function useOffersTicket(offer: TicketActions | null) {
  const current = useCurrentContext();
  const { actions, set } = current;
  useEffect(() => {
    actions.current = offer;
    return () => {
      actions.current = null;
    };
  });
  const key = offer?.key ?? null;
  useEffect(() => {
    set(key);
    return () => set(null);
  }, [set, key]);
}

/** The same seam for the Selection: the verbs in a ref for the keys, the members in state for the palette. */
export function useOffersSelection(offer: SelectionActions | null) {
  const { selectionActions, setMembers } = useCurrentContext();
  useEffect(() => {
    selectionActions.current = offer;
    return () => {
      selectionActions.current = null;
    };
  });
  // the board memoises its members, so this is a new array only when a poll or a tick really changed one
  const members = offer?.members ?? NO_MEMBERS;
  useEffect(() => {
    setMembers(members);
    return () => setMembers(NO_MEMBERS);
  }, [setMembers, members]);
}

/** What `a`, `s`, `d` and the palette reach for. */
export function useCurrentTicket(): Current {
  const { key, actions, members, selectionActions } = useCurrentContext();
  return { key, actions, members, selectionActions };
}
