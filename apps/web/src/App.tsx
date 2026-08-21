import { useEffect, useMemo } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { formatRef } from '@goblin/schema';
import { useRoute, href } from './router.ts';
import { useHealth } from './useHealth.ts';
import { Board } from './pages/Board.tsx';
import { Ticket } from './pages/Ticket.tsx';
import { Trace } from './pages/Trace.tsx';

/**
 * Resolves a pre-ref-migration `#/t/<n>` link: rewrites to the canonical URL
 * when exactly one project has that number, or names the candidates rather
 * than silently opening one when more than one does.
 */
function LegacyTicket({ shortId }: { shortId: number }) {
  const [tickets] = useQuery(useMemo(() => queries.ticket({ shortId }), [shortId]));

  useEffect(() => {
    if (tickets.length === 1) location.replace(href.ticket(tickets[0]!.project!.key, tickets[0]!.shortId));
  }, [tickets]);

  if (tickets.length > 1) {
    return (
      <div className="page">
        <h2 style={{ fontSize: 22, margin: '2px 0 8px' }}>More than one ticket is numbered {shortId}</h2>
        <div className="panel">
          {tickets.map(t => (
            <a key={t.id} className="mono" style={{ display: 'block', padding: '6px 0' }}
               href={href.ticket(t.project!.key, t.shortId)}>
              {formatRef(t.project!.key, t.shortId)} · {t.title}
            </a>
          ))}
        </div>
      </div>
    );
  }
  return <div className="page">Loading #{shortId}…</div>;
}

export function App() {
  const route = useRoute();
  const health = useHealth();
  return (
    <>
      <header className="topbar">
        <h1><a href={href.board} style={{ color: 'inherit' }}>Goblin Foundry</a></h1>
        <span className="eyebrow">the night shift</span>
        <span className="spacer" />
        {health.ok
          ? <span className="eyebrow">M0 · thin slice</span>
          : <span className="offline" title={health.detail}>{health.label}</span>}
      </header>
      {!health.ok && (
        <div className="offline-bar" role="status">
          {health.detail}
          {health.recover && <button onClick={health.recover}>{health.recoverLabel ?? 'retry'}</button>}
        </div>
      )}
      {route.name === 'board' && <Board />}
      {route.name === 'ticket' && <Ticket projectKey={route.key} shortId={route.shortId} />}
      {route.name === 'ticket-legacy' && <LegacyTicket shortId={route.shortId} />}
      {route.name === 'run' && <Trace runId={route.runId} />}
    </>
  );
}
