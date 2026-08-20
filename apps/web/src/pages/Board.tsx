import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { href } from '../router.ts';
import { api } from '../api.ts';
import { usd } from '../format.ts';
import { navigationOrder, nextFocusedId, prevFocusedId, reconcileFocus, isNavKeyIgnored } from '../boardNav.ts';

export function Board() {
  const [statuses] = useQuery(useMemo(() => queries.statuses(), []));
  const [tickets] = useQuery(useMemo(() => queries.board(), []));
  const [over, setOver] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLAnchorElement>());

  // Empty terminal columns are noise on a board with two tickets.
  const shown = useMemo(
    () => statuses.filter(s => !['canceled'].includes(s.kind) || tickets.some(t => t.statusId === s.id)),
    [statuses, tickets],
  );

  const order = useMemo(() => navigationOrder(shown, tickets), [shown, tickets]);

  useEffect(() => {
    setFocusedId(f => reconcileFocus(order, f));
  }, [order]);

  useEffect(() => {
    if (focusedId) cardRefs.current.get(focusedId)?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isNavKeyIgnored({ metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null })) return;
      if (e.key === 'j') { e.preventDefault(); setFocusedId(f => nextFocusedId(order, f)); }
      else if (e.key === 'k') { e.preventDefault(); setFocusedId(f => prevFocusedId(order, f)); }
      else if (e.key === 'Enter' && focusedId) { cardRefs.current.get(focusedId)?.click(); }
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [order, focusedId]);

  return (
    <div className="board">
      {shown.map(status => {
        const cards = tickets.filter(t => t.statusId === status.id);
        return (
          <section
            key={status.id}
            className={`column${over === status.id ? ' over' : ''}${cards.length ? '' : ' empty'}`}
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
                  ref={el => {
                    if (el) cardRefs.current.set(ticket.id, el);
                    else cardRefs.current.delete(ticket.id);
                  }}
                  className={`card${focusedId === ticket.id ? ' focused' : ''}`}
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
