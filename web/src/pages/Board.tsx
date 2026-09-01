import { useCallback, useEffect, useRef, useState } from 'react';
import { dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { TICKET_STATUSES, asksBeforeBlocked, blockedWarning, structuralRefusal, transitionTo, type Ticket, type TicketStatus } from '@goblin/shared';
import { useKey } from '../keys';
import { useTickets, useTransition } from '../queries';
import { useCrumb } from '../shell';
import { TicketCard, asDraggedCard, useNames, useNewTicket, type DraggedCard } from '../tickets';
import { Confirm, Empty, Kbd, Tile, refusalLine, useMinute, useRefusal } from '../ui';

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

/** One sentence under the column the drop was refused at (DESIGN.md §6). */
interface Refusal {
  status: TicketStatus;
  text: string;
}

/** A drop the board is holding until the human says yes; same slot as a refusal, with a way through. */
interface Pending extends Refusal {
  go: () => void;
}

/**
 * Dragging a card between columns *is* a transition (CONTEXT.md): the drop
 * looks the edge up in the table, moves the card optimistically and puts it
 * back with the API's `hint` if the move is refused. A column the card has no
 * arrow to says so instead of asking.
 */
function useDragToTransition(lookup: (key: string) => Ticket | undefined) {
  const move = useTransition();
  const [dragging, setDragging] = useState<TicketStatus | null>(null);
  const { refusal, setRefusal } = useRefusal<Refusal>();
  const [pending, setPending] = useState<Pending | null>(null);

  const drop = useCallback(
    (card: DraggedCard, to: TicketStatus) => {
      setPending(null);
      if (card.status === to) return; // a card dropped back where it came from has not moved — position in a column means nothing
      const edge = transitionTo(card.status, to);
      if (!edge) return setRefusal({ status: to, text: structuralRefusal(card.status, to) });
      const go = () => {
        setPending(null);
        move.mutate({ key: card.key, name: edge.name, to }, { onError: (error) => setRefusal({ status: to, text: refusalLine(error) }) });
      };
      const ticket = lookup(card.key);
      if (ticket && asksBeforeBlocked(edge.name, ticket)) return setPending({ status: to, text: blockedWarning(ticket.blocked_by), go });
      go();
    },
    [lookup, move, setRefusal],
  );

  // the monitor is registered once; the handler it reaches for is always the latest render's
  const latest = useRef(drop);
  useEffect(() => {
    latest.current = drop;
  }, [drop]);

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => asDraggedCard(source.data) !== null,
        onDragStart: ({ source }) => {
          setRefusal(null); // a refusal clears on the next drag (DESIGN.md §6)
          setPending(null);
          setDragging(asDraggedCard(source.data)?.status ?? null);
        },
        onDrop: ({ source, location }) => {
          setDragging(null);
          const card = asDraggedCard(source.data);
          const to = location.current.dropTargets[0]?.data.status;
          if (card && typeof to === 'string') latest.current(card, to as TicketStatus);
        },
      }),
    [setRefusal],
  );

  return { dragging, refusal, pending, cancel: useCallback(() => setPending(null), []) };
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
  const cards = tickets.data;
  const { dragging, refusal, pending, cancel } = useDragToTransition(useCallback((key: string) => cards?.find((t) => t.key === key), [cards]));
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
      span
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
            // legal columns are marked, never the illegal ones dimmed (DESIGN.md §6)
            legal={dragging === null ? null : dragging !== status && transitionTo(dragging, status) !== undefined}
            refusal={refusal?.status === status ? refusal.text : null}
            pending={pending?.status === status ? pending : null}
            onCancel={cancel}
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
  legal,
  refusal,
  pending,
  onCancel,
}: {
  status: TicketStatus;
  tickets: Ticket[];
  head: React.ReactNode;
  meta: ((t: Ticket) => string) | undefined;
  updated: boolean;
  at: number;
  /** `null` when no drag is live; otherwise whether the dragged card has an arrow here. */
  legal: boolean | null;
  refusal: string | null;
  /** A drop this column is holding until the human confirms it. */
  pending: Pending | null;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  // every column accepts the drop; a column with no arrow refuses it in words rather than swallowing the gesture
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      getData: (): Record<string, unknown> => ({ status }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: () => setOver(false),
    });
  }, [status]);

  const marks = legal === null ? '' : legal ? ' is-legal' : ' is-illegal';
  return (
    <div ref={ref} className={`gf-col${marks}${over ? ' is-over' : ''}`} data-testid={`col-${status}`}>
      <div className="gf-col-head">
        {status}
        <b>{tickets.length}</b>
      </div>
      {head}
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} meta={meta ? meta(t) : null} updated={updated ? t.updated_at : null} at={at} />
      ))}
      {refusal && (
        <p className="gf-refusal gf-col-refusal" role="alert" data-testid={`refusal-${status}`}>
          {refusal}
        </p>
      )}
      {pending && <Confirm text={pending.text} verb="start" onConfirm={pending.go} onCancel={onCancel} testId={`confirm-${status}`} />}
    </div>
  );
}
