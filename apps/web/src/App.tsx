import { useRoute, href } from './router.ts';
import { useHealth } from './useHealth.ts';
import { Board } from './pages/Board.tsx';
import { Ticket } from './pages/Ticket.tsx';
import { Trace } from './pages/Trace.tsx';

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
      {route.name === 'ticket' && <Ticket shortId={route.shortId} />}
      {route.name === 'run' && <Trace runId={route.runId} />}
    </>
  );
}
