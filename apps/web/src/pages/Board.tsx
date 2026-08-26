import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { formatRef, unfinishedBlockers, TRIGGER_STAGES } from '@goblin/schema';
import { href } from '../router.ts';
import { api } from '../api.ts';
import { spendOrTokens } from '../format.ts';
import { stuckFrom } from '../inbox.ts';
import { navigationOrder, nextFocusedId, prevFocusedId, reconcileFocus, isNavKeyIgnored } from '../boardNav.ts';
import { boardColumns, ticketInColumn } from '../boardColumns.ts';

export function Board() {
  const [statuses] = useQuery(useMemo(() => queries.statuses(), []));
  const [tickets] = useQuery(useMemo(() => queries.board(), []));
  const [over, setOver] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLAnchorElement>());

  const columns = useMemo(() => boardColumns(statuses), [statuses]);

  // The same determination the inbox uses, so a card never disagrees with its own row there.
  const stuckIds = useMemo(
    () => new Set(stuckFrom(tickets, TRIGGER_STAGES, statuses).map(s => s.ticketId)),
    [tickets, statuses],
  );

  // Empty terminal columns are noise on a board with two tickets.
  const shown = useMemo(
    () => columns.filter(c => c.kind !== 'canceled' || tickets.some(t => ticketInColumn(t, c))),
    [columns, tickets],
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
      {shown.map(column => {
        const cards = tickets.filter(t => ticketInColumn(t, column));
        return (
          <section
            key={column.kind}
            className={`column${over === column.kind ? ' over' : ''}${cards.length ? '' : ' empty'}`}
            onDragOver={e => { e.preventDefault(); setOver(column.kind); }}
            onDragLeave={() => setOver(o => (o === column.kind ? null : o))}
            onDrop={async e => {
              e.preventDefault();
              setOver(null);
              const ticketId = e.dataTransfer.getData('text/plain');
              if (ticketId) await api.moveTicket(ticketId, column.kind);
            }}
          >
            <h2>
              <span className="dot" style={{ background: column.color }} />
              {column.name}
              <span className="count">{cards.length}</span>
            </h2>
            {cards.map(ticket => {
              const run = ticket.runs[0];
              // The project relation syncs alongside the ticket but is not
              // guaranteed to have arrived on the same tick; skip the card
              // rather than throw on a row Zero hasn't finished replicating.
              if (!ticket.project) return null;
              const blockers = unfinishedBlockers(ticket.blockedBy ?? []).filter(b => b.project);
              return (
                <a
                  key={ticket.id}
                  ref={el => {
                    if (el) cardRefs.current.set(ticket.id, el);
                    else cardRefs.current.delete(ticket.id);
                  }}
                  className={`card${focusedId === ticket.id ? ' focused' : ''}`}
                  href={href.ticket(ticket.project.key, ticket.shortId)}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', ticket.id)}
                >
                  <div className="id">{formatRef(ticket.project.key, ticket.shortId)}</div>
                  <div className="title">{ticket.title}</div>
                  <div className="meta">
                    <span className="pill">{ticket.type}</span>
                    {ticket.delegate && <span className="pill agent">{ticket.delegate}</span>}
                    {run && (
                      <span className={`pill ${run.status === 'fail' ? 'bad' : run.status === 'success' ? 'ok' : 'code'}`}>
                        run {run.status} · {spendOrTokens(run)}
                      </span>
                    )}
                    {run?.questions.length ? <span className="pill human">answer me</span> : null}
                    {column.kind === 'design_review' && <span className="pill human">needs you</span>}
                    {stuckIds.has(ticket.id) && <span className="pill bad">stuck</span>}
                    {blockers.length > 0 && (
                      <span className="pill bad" title={`blocked by ${blockers.map(b => formatRef(b.project!.key, b.shortId)).join(', ')}`}>
                        blocked by {blockers.map(b => formatRef(b.project!.key, b.shortId)).join(', ')}
                      </span>
                    )}
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
