import { useState } from 'react';
import { marked } from 'marked';
import { api } from '../api.ts';
import { clock } from '../format.ts';
import { sandboxedReviewDoc } from '../sandbox.ts';

export type DesignRecord = {
  id: string;
  version: number;
  status: string;
  markdown: string;
  reviewHtml?: string | null;
  notes: readonly unknown[];
};

type Note = { at?: string; note?: string };

/**
 * The design, in the two shapes it exists in: the human document the planner
 * wrote for you, and the markdown the builder works from. Your annotations
 * accumulate here; sending it back is a separate act, so you can read the whole
 * thing first, and they become the next planner round. `onDecided` fires after
 * a successful approve or send-back, so a caller (the inbox) can move the item
 * to "Handled just now" — the ticket page just ignores it.
 */
export function Design({ design, onDecided }: {
  design: DesignRecord;
  onDecided?: (outcome: 'approved' | 'rejected', note: string) => void;
}) {
  const review = design.reviewHtml ?? '';
  const [view, setView] = useState<'review' | 'markdown'>(review ? 'review' : 'markdown');
  const [note, setNote] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const [backNote, setBackNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notes = (design.notes ?? []) as Note[];

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = () => act(async () => {
    await api.approveDesign(design.id);
    onDecided?.('approved', '');
  });

  const sendBack = () => {
    if (!backNote.trim()) { setError('a reason is required'); return; }
    void act(async () => {
      await api.rejectDesign(design.id, backNote.trim());
      setSendingBack(false);
      onDecided?.('rejected', backNote.trim());
    });
  };

  return (
    <div className="panel">
      <div className="design-head">
        <strong>v{design.version}</strong>
        <span className={`pill ${design.status === 'approved' ? 'ok' : design.status === 'rejected' ? 'bad' : 'human'}`}>
          {design.status}
        </span>
        {review && (
          <span className="tabs inline" role="tablist">
            <button role="tab" aria-selected={view === 'review'} onClick={() => setView('review')}>For you</button>
            <button role="tab" aria-selected={view === 'markdown'} onClick={() => setView('markdown')}>For the builder</button>
          </span>
        )}
        <span style={{ marginLeft: 'auto' }} />
        {design.status === 'in_review' && !sendingBack && (
          <>
            <button className="btn ghost" disabled={busy} onClick={() => { setSendingBack(true); setError(''); }}>
              Send back{notes.length ? ` with ${notes.length} note${notes.length > 1 ? 's' : ''}` : ''}
            </button>
            <button className="btn" disabled={busy} onClick={() => void approve()}>
              Approve
            </button>
          </>
        )}
      </div>

      {error && !sendingBack && <div className="ask-error">{error}</div>}

      {view === 'review' && review
        ? <iframe className="review" title={`Design v${design.version}`} sandbox="" srcDoc={sandboxedReviewDoc(review)} />
        : <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(design.markdown) as string }} />}

      {sendingBack && (
        <div className="sheet-backdrop" onClick={() => setSendingBack(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="ask-header mono">Why is this going back?</div>
            <textarea
              autoFocus
              placeholder="What needs to change?"
              value={backNote}
              disabled={busy}
              onChange={e => setBackNote(e.target.value)}
            />
            {error && <div className="ask-error">{error}</div>}
            <div className="asks-foot">
              <button className="btn ghost" disabled={busy} onClick={() => { setSendingBack(false); setError(''); }}>Cancel</button>
              <button className="btn" disabled={busy || !backNote.trim()} onClick={sendBack}>Send back</button>
            </div>
          </div>
        </div>
      )}

      <div className="annotations">
        <div className="ask-header mono">Annotations</div>
        {notes.map((n, i) => (
          <div key={i} className="annotation">
            <span>{n.note}</span>
            {n.at && <span className="mono when">{clock(Date.parse(n.at))}</span>}
          </div>
        ))}
        {!notes.length && <div className="muted">Nothing yet. A note here becomes the planner's next round.</div>}
        <div className="ask-other">
          <input
            placeholder="What needs to change?"
            value={note}
            disabled={busy}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || !note.trim()) return;
              void act(async () => { await api.annotateDesign(design.id, note.trim()); setNote(''); });
            }}
          />
          <button className="btn ghost" disabled={busy || !note.trim()}
                  onClick={() => act(async () => { await api.annotateDesign(design.id, note.trim()); setNote(''); })}>
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}
