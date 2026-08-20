import { useState } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { marked } from 'marked';
import { href } from '../router.ts';
import { api } from '../api.ts';
import { clock, usd } from '../format.ts';

export function Ticket({ shortId }: { shortId: number }) {
  const [tickets] = useQuery(queries.ticket({ shortId }));
  const ticket = tickets[0];
  const [tab, setTab] = useState<'body' | 'design' | 'runs'>('body');
  const [busy, setBusy] = useState(false);

  if (!ticket) return <div className="page">Loading FAC-{shortId}…</div>;
  const design = ticket.designs[0];
  const status = ticket.status;

  return (
    <div className="page">
      <div className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>FAC-{ticket.shortId}</div>
      <h2 style={{ fontSize: 28, margin: '2px 0 8px' }}>{ticket.title}</h2>
      <div className="meta" style={{ display: 'flex', gap: 6 }}>
        {status && <span className="pill" style={{ color: status.color }}>{status.name}</span>}
        <span className="pill">{ticket.type}</span>
        {ticket.assignee && <span className="pill human">{ticket.assignee}</span>}
        {ticket.delegate && <span className="pill agent">{ticket.delegate}</span>}
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'body'} onClick={() => setTab('body')}>Ticket</button>
        <button role="tab" aria-selected={tab === 'design'} onClick={() => setTab('design')}>
          Design{ticket.designs.length ? ` v${ticket.designs[0]!.version}` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>
          Runs{ticket.runs.length ? ` (${ticket.runs.length})` : ''}
        </button>
      </div>

      {tab === 'body' && (
        <div className="panel md" dangerouslySetInnerHTML={{ __html: marked.parse(ticket.body || '_No description._') as string }} />
      )}

      {tab === 'design' && (
        !design ? <div className="panel">No design yet. Run <code>/plan {ticket.shortId}</code> in your terminal.</div> : (
          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <strong>v{design.version}</strong>
              <span className={`pill ${design.status === 'approved' ? 'ok' : design.status === 'rejected' ? 'bad' : 'human'}`}>
                {design.status}
              </span>
              <span className="spacer" style={{ marginLeft: 'auto' }} />
              {design.status === 'in_review' && (
                <>
                  <button className="btn ghost" disabled={busy} onClick={async () => {
                    const note = prompt('What needs to change?') ?? '';
                    setBusy(true);
                    try { await api.rejectDesign(design.id, note); } finally { setBusy(false); }
                  }}>Request changes</button>
                  <button className="btn" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { await api.approveDesign(design.id); } finally { setBusy(false); }
                  }}>Approve</button>
                </>
              )}
            </div>
            <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(design.markdown) as string }} />
          </div>
        )
      )}

      {tab === 'runs' && (
        <div className="panel">
          {!ticket.runs.length && <div>No runs yet.</div>}
          {ticket.runs.map(run => (
            <div key={run.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <a className="mono" href={href.run(run.id)}>{run.id}</a>
              <span className={`pill ${run.status === 'fail' ? 'bad' : run.status === 'success' ? 'ok' : 'code'}`}>{run.status}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{run.branch ?? '—'}</span>
              <span className="spacer" style={{ marginLeft: 'auto' }} />
              <span className="mono" style={{ fontSize: 12 }}>{usd(run.costUsd)}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{clock(run.startedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
