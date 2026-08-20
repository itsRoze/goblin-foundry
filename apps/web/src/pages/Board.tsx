import { useMemo, useState } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { href } from '../router.ts';
import { api } from '../api.ts';
import { usd } from '../format.ts';

export function Board() {
  const [statuses] = useQuery(useMemo(() => queries.statuses(), []));
  const [tickets] = useQuery(useMemo(() => queries.board(), []));
  const [over, setOver] = useState<string | null>(null);

  // Empty terminal columns are noise on a board with two tickets.
  const shown = statuses.filter(
    s => !['canceled'].includes(s.kind) || tickets.some(t => t.statusId === s.id),
  );

  return (
    <div className="board">
      {shown.map(status => {
        const cards = tickets.filter(t => t.statusId === status.id);
        return (
          <section
            key={status.id}
            className={`column${over === status.id ? ' over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOver(status.id); }}
            onDragLeave={() => setOver(o => (o === status.id ? null : o))}
            onDrop={async e => {
              e.preventDefault();
              setOver(null);
              const ticketId = e.dataTransfer.getData('text/plain');
              if (ticketId) await api.moveTicket(ticketId, status.kind);
            }}
          >
            <h2>
              <span className="dot" style={{ background: status.color }} />
              {status.name}
              <span className="count">{cards.length}</span>
            </h2>
            {cards.map(ticket => {
              const run = ticket.runs[0];
              return (
                <a
                  key={ticket.id}
                  className="card"
                  href={href.ticket(ticket.shortId)}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', ticket.id)}
                >
                  <div className="id">FAC-{ticket.shortId}</div>
                  <div className="title">{ticket.title}</div>
                  <div className="meta">
                    <span className="pill">{ticket.type}</span>
                    {ticket.delegate && <span className="pill agent">{ticket.delegate}</span>}
                    {run && (
                      <span className={`pill ${run.status === 'fail' ? 'bad' : run.status === 'success' ? 'ok' : 'code'}`}>
                        run {run.status} · {usd(run.costUsd)}
                      </span>
                    )}
                    {status.kind === 'design_review' && <span className="pill human">needs you</span>}
                  </div>
                </a>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
