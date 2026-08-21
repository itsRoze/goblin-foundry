import { useEffect, useMemo } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { formatRef, resolveRef } from '@goblin/schema';
import { useRoute, href } from './router.ts';
import { useHealth } from './useHealth.ts';
import { useInboxSections, inboxCount } from './useInbox.ts';
import { Board } from './pages/Board.tsx';
import { Ticket } from './pages/Ticket.tsx';
import { Trace } from './pages/Trace.tsx';
import { Inbox } from './pages/Inbox.tsx';

/**
 * Resolves a pre-ref-migration `#/t/<n>` link: rewrites to the canonical URL
 * when exactly one project has that number, or names the candidates rather
 * than silently opening one when more than one does.
 *
 * Zero delivers rows incrementally, so this waits for `result.type ===
 * 'complete'` before deciding: judging ambiguity off a partial result could
 * auto-navigate to the first candidate to arrive before a second one lands.
 */
function LegacyTicket({ shortId }: { shortId: number }) {
  const [tickets, result] = useQuery(useMemo(() => queries.ticket({ shortId }), [shortId]));
  const candidates = useMemo(
    () => tickets.filter(t => t.project).map(t => ({ key: t.project!.key, shortId: t.shortId, ticket: t })),
    [tickets],
  );
  const resolution = result.type === 'complete' ? resolveRef(String(shortId), candidates) : null;

  useEffect(() => {
    if (resolution?.status === 'unique') location.replace(href.ticket(resolution.candidate.key, resolution.candidate.shortId));
  }, [resolution]);

  if (resolution?.status === 'ambiguous') {
    return (
      <div className="page">
        <h2 style={{ fontSize: 22, margin: '2px 0 8px' }}>More than one ticket is numbered {shortId}</h2>
        <div className="panel">
          {resolution.candidates.map(c => (
            <a key={c.ticket.id} className="mono" style={{ display: 'block', padding: '6px 0' }}
               href={href.ticket(c.key, c.shortId)}>
              {formatRef(c.key, c.shortId)} · {c.ticket.title}
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
  const sections = useInboxSections();
  const count = inboxCount(sections);
  return (
    <>
      <header className="topbar">
        <h1><a href={href.board} style={{ color: 'inherit' }}>Goblin Foundry</a></h1>
        <span className="eyebrow">the night shift</span>
        <a className="inbox-link" href={href.inbox}>
          Inbox{count > 0 && <span className="badge">{count}</span>}
        </a>
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
      {route.name === 'inbox' && <Inbox itemId={route.itemId} />}
    </>
  );
}
