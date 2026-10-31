import { useState } from 'react';
import { ticketLabels, type Ticket } from '@goblin/shared';
import { useSetLabels } from './queries';
import { useBulkLock } from './selecting';
import { refusalLine } from './ui';

/**
 * A Ticket's Labels on its own view (ADR-0013): plain chips, never colour,
 * each with its `×`, and a `+ label` that opens one input. The API takes the
 * whole set, so a chip added or dropped here is the set it leaves sent in one
 * write; the names are judged there, and a refusal is the Piece's sentence.
 */
export function LabelsField({ ticket }: { ticket: Ticket }) {
  const write = useSetLabels();
  const { guard } = useBulkLock(ticket);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const send = async (labels: string[]) => {
    setRefusal(null);
    try {
      await guard(() => write.mutateAsync({ key: ticket.key, labels }));
      return true;
    } catch (e) {
      setRefusal(refusalLine(e));
      return false;
    }
  };
  const close = () => {
    setAdding(false);
    setDraft('');
  };
  // several at once, as the CLI takes them: `needs-info, wayfinder:task`
  const add = async () => {
    if (draft.trim() === '') return close();
    if (await send([...ticket.labels, ...draft.split(',')])) setDraft('');
  };
  const drop = (label: string) => void send(ticket.labels.filter((l) => l !== ticketLabels.normalise(label)));

  return (
    <div className="gf-labels" data-testid="labels">
      {ticket.labels.map((label) => (
        <span key={label} className="gf-chip gf-label" data-testid={`label-${label}`}>
          {label}
          <button type="button" className="gf-label-drop" aria-label={`remove label ${label}`} disabled={write.isPending} onClick={() => drop(label)}>
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
          // the `+ label` press is what opened it, so the caret is wanted here at once
          autoFocus
          value={draft}
          disabled={write.isPending}
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
          onBlur={() => draft.trim() === '' && close()}
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
