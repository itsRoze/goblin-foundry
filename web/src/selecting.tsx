import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BulkAction, BulkRefusal } from '@goblin/shared';
import * as api from './api';
import { ProblemError } from './api';
import { bulkLabel, eligibilitySignature, preflight, questionFor, setSignature, type Member, type Question } from './bulk';
import { EMPTY_SELECTION, reconcile, type Selection } from './selection';

/**
 * Who owns the Selection, and the one bulk action that may be out at a time
 * (issue 03b). It sits in the shell, above the pages, for two reasons the
 * ticket names: a Selection survives a trip into a Ticket view and back, and a
 * submitted action keeps running — and keeps its Tickets locked — wherever you
 * go meanwhile. It is memory and nothing else: a full reload starts empty,
 * because an old set silently restored is a loaded control.
 */

/** A submitted action: frozen at the moment it went, whatever the board shows since. */
export interface PendingBulk {
  action: BulkAction;
  ids: ReadonlySet<number>;
  /** *Approving 10 Tickets…* */
  label: string;
}

/**
 * How it ended, or what the board had to say instead of sending it.
 * `refused` is definite — the API answered, or the table did, and nothing
 * changed. `unknown` is the answer that never arrived: it may have committed,
 * so it never says otherwise and is never sent again by itself.
 */
export type BulkOutcome =
  | { kind: 'done'; text: string }
  | { kind: 'said'; text: string }
  | { kind: 'refused'; refusals: BulkRefusal[]; sentence: string | null }
  | { kind: 'unknown' };

export const NOTHING_CHANGED = 'Nothing changed';
export const OUTCOME_UNKNOWN = "Couldn't confirm the outcome";

interface Selecting {
  selection: Selection;
  /** Ignored while an action is out: the submitted set is frozen until it answers. */
  change: (next: (current: Selection) => Selection) => void;
  /** The board's poll and Filter, applied: what left the board leaves the Selection. Never frozen. */
  keepOnly: (live: ReadonlySet<number>) => void;
  pending: PendingBulk | null;
  outcome: BulkOutcome | null;
  report: (outcome: BulkOutcome | null) => void;
  submit: (action: BulkAction, members: readonly Member[]) => void;
}

const SelectingContext = createContext<Selecting | null>(null);

/** How long a sentence that needs no answer stays: the refusal's four seconds (DESIGN.md Components). */
const PASSING_MS = 4_000;

export function SelectingProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  /** Read by handlers, which must see a submit that happened in this same tick. */
  const busy = useRef(false);

  const change = useCallback((next: (current: Selection) => Selection) => {
    if (!busy.current) setSelection(next);
  }, []);
  const keepOnly = useCallback((live: ReadonlySet<number>) => setSelection((current) => reconcile(current, live)), []);

  // `done` and `said` need no answer and clear themselves; a refusal and a lost response stay until dismissed
  useEffect(() => {
    if (outcome === null || (outcome.kind !== 'done' && outcome.kind !== 'said')) return;
    const timer = setTimeout(() => setOutcome(null), PASSING_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const submit = useCallback(
    (action: BulkAction, members: readonly Member[]) => {
      if (busy.current || members.length === 0) return;
      busy.current = true;
      setOutcome(null);
      setPending({ action, ids: new Set(members.map((t) => t.id)), label: bulkLabel(action, members.length, 'pending') });
      void api
        .post('/api/tickets/bulk', { tickets: members.map((t) => t.key), action })
        .then(
          () => {
            // the whole set changed, so the whole Selection is spent
            setSelection(EMPTY_SELECTION);
            setOutcome({ kind: 'done', text: bulkLabel(action, members.length, 'done') });
          },
          (error: unknown) => {
            // only the API's own problem document is an answer. No network, no JSON, or a bare 502 from something in
            // between says nothing about whether the batch committed, and must never be read as "nothing changed"
            if (error instanceof ProblemError && error.problem.title !== undefined) setOutcome({ kind: 'refused', refusals: error.problem.refusals ?? [], sentence: error.problem.refusals?.length ? null : error.sentence });
            else setOutcome({ kind: 'unknown' });
          },
        )
        .finally(() => {
          busy.current = false;
          setPending(null);
          // one atomic result, so one reconciliation: no optimistic half-state was ever drawn
          void qc.invalidateQueries();
        });
    },
    [qc],
  );

  const value = useMemo((): Selecting => ({ selection, change, keepOnly, pending, outcome, report: setOutcome, submit }), [selection, change, keepOnly, pending, outcome, submit]);
  return <SelectingContext.Provider value={value}>{children}</SelectingContext.Provider>;
}

export function useSelecting(): Selecting {
  const selecting = useContext(SelectingContext);
  if (selecting === null) throw new Error('a selection outside the shell');
  return selecting;
}

/** What the board gets back for its Selection: the way to act on it, and the question an action may be waiting on. */
export interface BulkAsk {
  act: (action: BulkAction) => void;
  question: Question | null;
  confirm: () => void;
  cancel: () => void;
}

/**
 * One action on a whole Selection, from a key, the palette or the bar. What
 * the shared table can already refuse is refused here, in its words; what
 * needs a yes is asked once; the rest goes as one request (ADR-0010).
 *
 * The question is bound to exactly the Tickets it was asked about, as they
 * stood. A different set withdraws it. A change to what makes a member
 * eligible or blocked is checked again, and the question — always drawn from
 * the members as they are now — says the new thing before any yes is given;
 * if nothing is left to ask, it is withdrawn rather than left asking about
 * nothing. A retitled Ticket changes neither signature, so it disturbs nothing.
 */
export function useBulkAction(members: readonly Member[]): BulkAsk {
  const { pending, report, submit } = useSelecting();
  const [asking, setAsking] = useState<{ action: BulkAction; set: string } | null>(null);
  const setNow = setSignature(members);
  const eligibleNow = eligibilitySignature(members);

  const act = useCallback(
    (action: BulkAction) => {
      if (pending !== null || members.length === 0) return;
      setAsking(null);
      const refusals = preflight(action, members);
      if (refusals.length > 0) return report({ kind: 'refused', refusals, sentence: null });
      report(null);
      if (questionFor(action, members) !== null) return setAsking({ action, set: setNow });
      submit(action, members);
    },
    [pending, members, setNow, report, submit],
  );

  useEffect(() => {
    if (asking === null) return;
    if (asking.set !== setNow) return setAsking(null);
    const refusals = preflight(asking.action, members);
    if (refusals.length > 0) {
      setAsking(null);
      report({ kind: 'refused', refusals, sentence: null });
    } else if (questionFor(asking.action, members) === null) setAsking(null);
    // `members` is read, not listed: the two signatures are what about it matters here
  }, [asking, setNow, eligibleNow, report]);

  const confirm = useCallback(() => {
    if (asking === null) return;
    setAsking(null);
    submit(asking.action, members);
  }, [asking, members, submit]);
  const cancel = useCallback(() => setAsking(null), []);

  return { act, question: asking === null ? null : questionFor(asking.action, members), confirm, cancel };
}

/**
 * The pending lock, for anything that writes to one Ticket: while a submitted
 * action holds it, the write is refused here in the API's own shape, so every
 * surface files it in the slot it already has for a refusal.
 */
export function useBulkLock(ticket: { id: number; key: string }) {
  const { pending } = useSelecting();
  const locked = pending?.ids.has(ticket.id) ?? false;
  const label = pending?.label ?? '';
  const guard = useCallback(
    <T,>(write: () => Promise<T>): Promise<T> => (locked ? Promise.reject(new ProblemError(409, { hint: `${ticket.key} is held by a bulk action — ${label}` })) : write()),
    [locked, label, ticket.key],
  );
  return { locked, guard };
}

/** The same sentence said about several Tickets is said once, with their keys in front: ten refusals are usually two reasons. */
function byReason(refusals: readonly BulkRefusal[]): { reason: string; keys: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const r of refusals) groups.set(r.reason, [...(groups.get(r.reason) ?? []), r.key]);
  return [...groups].map(([reason, keys]) => ({ reason, keys }));
}

/** What is out, or how it ended — drawn in the board's selection bar, and by the shell on every other page. */
export function BulkStatus({ onDismiss }: { onDismiss: () => void }) {
  const { pending, outcome } = useSelecting();
  if (pending !== null)
    return (
      <p className="gf-bulk-status" role="status" data-testid="bulk-pending">
        {pending.label}
      </p>
    );
  if (outcome === null) return null;
  if (outcome.kind === 'done' || outcome.kind === 'said')
    return (
      <p className="gf-bulk-status" role="status" data-testid={`bulk-${outcome.kind}`}>
        {outcome.text}
      </p>
    );
  return (
    <div className="gf-bulk-status is-held" role="alert" data-testid={`bulk-${outcome.kind}`}>
      <p className="gf-bulk-title">
        <span>{outcome.kind === 'refused' ? NOTHING_CHANGED : OUTCOME_UNKNOWN}</span>
        <button type="button" className="gf-filter-clear gf-bulk-dismiss" aria-label="dismiss" data-testid="bulk-dismiss" onClick={onDismiss}>
          ×
        </button>
      </p>
      {outcome.kind === 'unknown' ? (
        <p className="gf-bulk-line">the board has been refreshed — check it before trying again</p>
      ) : (
        <ul className="gf-bulk-lines">
          {outcome.sentence !== null && <li>{outcome.sentence}</li>}
          {byReason(outcome.refusals).map((group) => (
            <li key={group.reason}>
              <span className="gf-bulk-keys">{group.keys.join(' ')}</span>
              {group.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
