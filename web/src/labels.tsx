import { useEffect, useRef, useState } from 'react';
import { splitLabels, type Ticket } from '@goblin/shared';
import { ProblemError } from './api';
import { useSetLabels } from './queries';
import { useBulkLock } from './selecting';
import { refusalLine } from './ui';

/** The Piece's sentence alone: the row's own `labels` key already says which field it is about. */
const refusalOf = (e: unknown) => (e instanceof ProblemError && e.problem.issues?.length ? e.problem.issues.map((i) => i.message).join(' · ') : refusalLine(e));

/**
 * A Ticket's Labels on its own view (ADR-0013): plain chips, never colour,
 * each with its `×`, and a `+ label` that opens one input. The API takes the
 * whole set, so a chip added or dropped here is the set it leaves sent in one
 * write; the names are judged there, and a refusal is the Piece's sentence.
 * Whether the input is open belongs to the view, because `⌘K` opens it too.
 */
export function LabelsField({ ticket, adding, setAdding }: { ticket: Ticket; adding: boolean; setAdding: (adding: boolean) => void }) {
  const write = useSetLabels();
  const { guard } = useBulkLock(ticket);
  const [draft, setDraft] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  /**
   * Where the caret goes once the chips re-render: the `×` now at this index
   * after a drop, or `+ label` past the end — focus never falls to the page
   * when the control that held it goes away.
   */
  const [refocus, setRefocus] = useState<number | null>(null);
  useEffect(() => {
    if (refocus === null || write.isPending) return;
    const drops = row.current?.querySelectorAll<HTMLButtonElement>('.gf-label-drop') ?? [];
    (drops[refocus] ?? row.current?.querySelector<HTMLButtonElement>('[data-testid="add-label"]'))?.focus();
    setRefocus(null);
  }, [refocus, write.isPending, ticket.labels]);

  const send = async (labels: string[]) => {
    setRefusal(null);
    try {
      await guard(() => write.mutateAsync({ key: ticket.key, labels }));
      return true;
    } catch (e) {
      setRefusal(refusalOf(e));
      return false;
    }
  };
  const close = () => {
    setAdding(false);
    setDraft('');
    setRefocus(ticket.labels.length);
  };
  // several at once, as the CLI takes them: `needs-info, wayfinder:task`
  const add = async () => {
    const names = splitLabels(draft);
    if (names.length === 0) return close();
    if (await send([...ticket.labels, ...names])) setDraft('');
  };
  // a chip is a label the ticket carries, already written as the Piece writes it
  const drop = async (label: string, at: number) => {
    if (await send(ticket.labels.filter((l) => l !== label))) setRefocus(at);
  };

  return (
    <div className="gf-labels" data-testid="labels" ref={row}>
      {ticket.labels.map((label, at) => (
        <span key={label} className="gf-chip gf-label" data-testid={`label-${label}`}>
          {label}
          <button type="button" className="gf-label-drop" aria-label={`remove label ${label}`} disabled={write.isPending} onClick={() => void drop(label, at)}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="gf-label-input"
          aria-label="add labels, comma-separated"
          placeholder="label, another"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // the `+ label` press (or `⌘K`) is what opened it, so the caret is wanted here at once
          autoFocus
          value={draft}
          // not `disabled`: that blurs it, and the caret is meant to stay for the next name
          readOnly={write.isPending}
          onChange={(e) => {
            setDraft(e.target.value);
            setRefusal(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          onBlur={() => {
            if (draft.trim() !== '') return;
            setAdding(false);
            setDraft('');
          }}
        />
      ) : (
        <button type="button" className="gf-dep-add" data-testid="add-label" onClick={() => setAdding(true)}>
          + label
        </button>
      )}
      {refusal && (
        <p className="gf-refusal" role="alert" data-testid="labels-refusal">
          {refusal}
        </p>
      )}
    </div>
  );
}
