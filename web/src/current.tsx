import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TransitionName } from '@goblin/shared';

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
  /** `move to app…` / `move to project…`, ADR-0007 applied as the Ticket view's selects apply it. */
  place: (field: 'app_id' | 'project_id', id: number | null) => void;
}

interface Current {
  /** The key, in state, so the palette re-renders when the cursor moves. */
  key: string | null;
  /** The verbs, in a ref, so a key handler always reaches this render's without re-binding. */
  actions: { current: TicketActions | null };
}

const CurrentContext = createContext<(Current & { set: (key: string | null) => void }) | null>(null);

export function CurrentTicketProvider({ children }: { children: ReactNode }) {
  const actions = useRef<TicketActions | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const value = useMemo(() => ({ key, actions, set: setKey }), [key]);
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

/** What `a`, `s`, `d` and the palette reach for. */
export function useCurrentTicket(): Current {
  const { key, actions } = useCurrentContext();
  return { key, actions };
}
