import { useRoute, href } from './router.ts';
import { Board } from './pages/Board.tsx';
import { Ticket } from './pages/Ticket.tsx';
import { Trace } from './pages/Trace.tsx';

export function App() {
  const route = useRoute();
  return (
    <>
      <header className="topbar">
        <h1><a href={href.board} style={{ color: 'inherit' }}>Goblin Foundry</a></h1>
        <span className="eyebrow">the night shift</span>
        <span className="spacer" />
        <span className="eyebrow">M0 · thin slice</span>
      </header>
      {route.name === 'board' && <Board />}
      {route.name === 'ticket' && <Ticket shortId={route.shortId} />}
      {route.name === 'run' && <Trace runId={route.runId} />}
    </>
  );
}
