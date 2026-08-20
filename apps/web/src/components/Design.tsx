import { useState } from 'react';
import { marked } from 'marked';
import { api } from '../api.ts';
import { clock } from '../format.ts';

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
 * thing first, and they become the next planner round.
 */
export function Design({ design }: { design: DesignRecord }) {
  const review = design.reviewHtml ?? '';
  const [view, setView] = useState<'review' | 'markdown'>(review ? 'review' : 'markdown');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = (design.notes ?? []) as Note[];

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
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
        {design.status === 'in_review' && (
          <>
            <button className="btn ghost" disabled={busy}
                    onClick={() => act(() => api.rejectDesign(design.id, ''))}>
              Send back{notes.length ? ` with ${notes.length} note${notes.length > 1 ? 's' : ''}` : ''}
            </button>
            <button className="btn" disabled={busy} onClick={() => act(() => api.approveDesign(design.id))}>
              Approve
            </button>
          </>
        )}
      </div>

      {view === 'review' && review
        ? <iframe className="review" title={`Design v${design.version}`} sandbox="" srcDoc={review} />
        : <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(design.markdown) as string }} />}

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
