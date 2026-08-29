import { useCallback, useState } from 'react';
import { TICKET_STATUSES, type Ticket, type TicketStatus } from '@goblin/shared';
import { useKey } from '../keys';
import { useTickets } from '../queries';
import { useCrumb } from '../shell';
import { TicketCard, useNames, useNewTicket } from '../tickets';
import { Empty, Kbd, Tile, useMinute } from '../ui';

/** Per-device display preferences, not filters: a filter chooses which tickets are on the board and lives in the URL (CONTEXT.md). */
interface View {
  meta: boolean;
  updated: boolean;
  cancelled: boolean;
}
const DEFAULT_VIEW: View = { meta: true, updated: false, cancelled: false };
const VIEW_STORAGE_KEY = 'gf.board.view';

function useView() {
  const [view, setView] = useState<View>(() => {
    try {
      return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? '{}') as Partial<View>) };
    } catch {
      return DEFAULT_VIEW;
    }
  });
  const toggle = (name: keyof View) =>
    setView((current) => {
      const next = { ...current, [name]: !current[name] };
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // a device that refuses storage still gets the board, just not the memory
      }
      return next;
    });
  return { view, toggle };
}

/** The kanban is home (CONTEXT.md): every live ticket, one column per status, in lifecycle order. */
export function BoardPage() {
  useCrumb('board');
  const tickets = useTickets({}, true);
  const names = useNames();
  const at = useMinute();
  const { view, toggle } = useView();
  const [menu, setMenu] = useState(false);
  const newTicket = useNewTicket({});
  useKey('v', useCallback(() => setMenu((m) => !m), []));

  const columns = TICKET_STATUSES.filter((s) => s !== 'cancelled' || view.cancelled);
  const meta = (t: Ticket) =>
    t.app_id === null && t.project_id === null ? '—' : `${t.app_id === null ? '—' : names.app(t.app_id)} / ${t.project_id === null ? '—' : names.project(t.project_id)}`;

  return (
    <Tile
      label="board"
      subtitle={tickets.data ? String(tickets.data.length) : undefined}
      keys={
        <>
          <Kbd>c</Kbd> new <Kbd>v</Kbd> view
        </>
      }
      focus
      testId="board-tile"
    >
      {tickets.isError && <p className="gf-refusal">could not reach the API: {tickets.error.message}</p>}
      {menu && (
        <div className="gf-view-menu" data-testid="view-menu">
          <label className="gf-toggle">
            <input type="checkbox" checked={view.meta} onChange={() => toggle('meta')} /> app / project
          </label>
          <label className="gf-toggle">
            <input type="checkbox" checked={view.updated} onChange={() => toggle('updated')} /> updated
          </label>
          <label className="gf-toggle">
            <input type="checkbox" checked={view.cancelled} onChange={() => toggle('cancelled')} /> show cancelled
          </label>
        </div>
      )}
      <div className="gf-cols" data-testid="board">
        {columns.map((status) => (
          <Column
            key={status}
            status={status}
            tickets={(tickets.data ?? []).filter((t) => t.status === status)}
            head={status === 'backlog' ? newTicket : null}
            meta={view.meta ? meta : undefined}
            updated={view.updated}
            at={at}
          />
        ))}
      </div>
      {tickets.data?.length === 0 && !newTicket && <Empty>no tickets yet — press c</Empty>}
    </Tile>
  );
}

/** Cards are ordered by id ascending, so the 5 s poll never reshuffles them under the pointer. */
function Column({
  status,
  tickets,
  head,
  meta,
  updated,
  at,
}: {
  status: TicketStatus;
  tickets: Ticket[];
  head: React.ReactNode;
  meta: ((t: Ticket) => string) | undefined;
  updated: boolean;
  at: number;
}) {
  return (
    <div className="gf-col" data-testid={`col-${status}`}>
      <div className="gf-col-head">
        {status}
        <b>{tickets.length}</b>
      </div>
      {head}
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} meta={meta ? meta(t) : null} updated={updated ? t.updated_at : null} at={at} />
      ))}
    </div>
  );
}
