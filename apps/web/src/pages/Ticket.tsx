import { useMemo, useState } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { formatRef } from '@goblin/schema';
import { marked } from 'marked';
import { href } from '../router.ts';
import { api } from '../api.ts';
import { clock, spendOrTokens } from '../format.ts';
import { Questions } from '../components/Questions.tsx';
import { Design } from '../components/Design.tsx';

export function Ticket({ projectKey, shortId }: { projectKey: string; shortId: number }) {
  // The request object must be stable: a fresh one every render re-subscribes forever.
  const [tickets] = useQuery(useMemo(() => queries.ticket({ shortId, key: projectKey }), [shortId, projectKey]));
  const ticket = tickets[0];
  const [tab, setTab] = useState<'body' | 'design' | 'runs'>('body');
  const ref = formatRef(projectKey, shortId);

  if (!ticket) return <div className="page">Loading {ref}…</div>;
  const design = ticket.designs[0];
  const status = ticket.status;
  // A parked phase is waiting on these, so they sit above the tabs, not inside one.
  const open = ticket.runs.flatMap(r => r.questions).filter(q => !q.answeredAt);

  const blockedBy = (ticket.blockedBy ?? []).filter(b => b.project);
  const blocks = (ticket.blocks ?? []).filter(b => b.project);
  const hasDeps = blockedBy.length > 0 || blocks.length > 0;

  return (
    <div className="page">
      <div className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{ref}</div>
      <h2 style={{ fontSize: 28, margin: '2px 0 8px' }}>{ticket.title}</h2>
      <div className="meta" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {status && <span className="pill" style={{ color: status.color }}>{status.name}</span>}
        <span className="pill">{ticket.type}</span>
        {ticket.assignee && <span className="pill human">{ticket.assignee}</span>}
        {ticket.delegate && <span className="pill agent">{ticket.delegate}</span>}
      </div>

      {hasDeps && (
        <div className="panel" style={{ marginTop: 14 }}>
          {blockedBy.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong>Blocked by:</strong>{' '}
              {blockedBy.map((b, i) => (
                <span key={b.id}>{i > 0 && ', '}<a href={href.ticket(b.project!.key, b.shortId)}>{formatRef(b.project!.key, b.shortId)}</a></span>
              ))}
            </div>
          )}
          {blocks.length > 0 && (
            <div>
              <strong>Blocks:</strong>{' '}
              {blocks.map((b, i) => (
                <span key={b.id}>{i > 0 && ', '}<a href={href.ticket(b.project!.key, b.shortId)}>{formatRef(b.project!.key, b.shortId)}</a></span>
              ))}
            </div>
          )}
        </div>
      )}

      <Questions questions={open} />

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
        !design
          ? <div className="panel">No design yet. Move the ticket to Ready for Design, or run <code>/plan {ref}</code> in your terminal.</div>
          : <Design design={design} />
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
              <span className="mono" style={{ fontSize: 12 }}>{spendOrTokens(run)}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{clock(run.startedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
