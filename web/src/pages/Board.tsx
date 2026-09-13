import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  DEFAULT_BOARD_STATUSES,
  FILTER_PARAMS,
  asksBeforeBlocked,
  blockedWarning,
  keyedMove,
  parseTicketFilter,
  serialiseTicketFilter,
  structuralRefusal,
  transitionTo,
  type Ticket,
  type TicketFilter,
  type TicketStatus,
  type Transition,
  type TransitionName,
} from '@goblin/shared';
import { ProblemError } from '../api';
import { useOffersTicket } from '../current';
import { useCursor, useEscape } from '../desk';
import { FilterBar, type BadValues } from '../filters';
import { useKey } from '../keys';
import { usePatchTicket, useTicketIntent, useTicketList, useTransition } from '../queries';
import { useCrumb } from '../shell';
import { TicketCard, asDraggedCard, homeLine, ticketPath, useBoardCreate, useNames, type DraggedCard } from '../tickets';
import { Confirm, Empty, Kbd, Tile, refusalLine, useMinute, useRefusal } from '../ui';

/**
 * Per-device display preferences, and nothing else: a View option decides how
 * the board shows what the Filter chose, never *which* tickets are on it, so
 * it never hides a status (CONTEXT.md "View option"). `show cancelled` used to
 * live here; it is the status Filter now (issue 06 reverses issue 03).
 */
interface View {
  meta: boolean;
  updated: boolean;
}
const DEFAULT_VIEW: View = { meta: true, updated: false };
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

/** One sentence under the column the drop was refused at (DESIGN.md Components). */
interface Refusal {
  status: TicketStatus;
  text: string;
}

/** A drop the board is holding until the human says yes; same slot as a refusal, with a way through. */
interface Pending extends Refusal {
  go: () => void;
}

/**
 * Every way the board moves a card, in one place, because they must agree:
 * dragging a card between columns *is* a transition (CONTEXT.md), and so is
 * pressing the key for one. The move is looked up in the table, applied
 * optimistically, and put back with the API's `hint` if it is refused; a move
 * the table has no arrow for is refused here, in words, without a round trip.
 *
 * The two differ only in which column the sentence lands under — the one you
 * dropped on, or the one the Cursor is in (DESIGN.md Components: a refusal is
 * placed where the action was refused).
 */
function useBoardMoves(lookup: (key: string) => Ticket | undefined) {
  const move = useTransition();
  const [dragging, setDragging] = useState<TicketStatus | null>(null);
  const { refusal, setRefusal } = useRefusal<Refusal>();
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useCallback(
    (card: DraggedCard, edge: Transition | undefined, slot: TicketStatus, structural: string) => {
      setPending(null);
      if (!edge) return setRefusal({ status: slot, text: structural });
      const go = () => {
        setPending(null);
        move.mutate({ key: card.key, name: edge.name, to: edge.to }, { onError: (error) => setRefusal({ status: slot, text: refusalLine(error) }) });
      };
      const ticket = lookup(card.key);
      if (ticket && asksBeforeBlocked(edge.name, ticket)) return setPending({ status: slot, text: blockedWarning(ticket.blocked_by), go });
      go();
    },
    [lookup, move, setRefusal],
  );

  /** The drop: the column names the edge, and a column with no arrow says so instead of swallowing the gesture. */
  const drop = useCallback(
    (card: DraggedCard, to: TicketStatus) => {
      setPending(null);
      if (card.status === to) return; // a card dropped back where it came from has not moved — position in a column means nothing
      run(card, transitionTo(card.status, to), to, structuralRefusal(card.status, to));
    },
    [run],
  );

  /** A key: the verb is named, so the refusal is about the arrow that is missing, said under the Cursor. */
  const press = useCallback(
    (card: DraggedCard, name: TransitionName) => {
      const asked = keyedMove(card.status, name);
      run(card, asked.ok ? asked.edge : undefined, card.status, asked.ok ? '' : asked.refusal);
    },
    [run],
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
          setRefusal(null); // a refusal clears on the next drag (DESIGN.md Components)
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

  return { dragging, refusal, pending, press, refuse: setRefusal, cancel: useCallback(() => setPending(null), []) };
}

/**
 * The four parameters exactly as the address wrote them. This is what goes to
 * the API when the parser refuses one of them: the refusal comes from the one
 * place that owns it, and the address is never rewritten to hide a mistake
 * (issue 06).
 */
function rawFilterSearch(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const name of FILTER_PARAMS) {
    const raw = params.get(name);
    if (raw !== null) out.set(name, raw);
  }
  return out.toString();
}

/**
 * The kanban is home (CONTEXT.md), and the Filter in the address says what is
 * on it: one column per status in the filter's set — the seven live ones by
 * default — in lifecycle order. The address is always *replaced*, never
 * pushed, so back never steps through filters.
 */
export function BoardPage() {
  useCrumb('board');
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  // the browser's address may carry the `<slug>-<id>` routes write; the wire only ever takes the id
  const parsed = useMemo(() => parseTicketFilter(params, { slugs: true }), [params]);
  /** What the API will refuse, as the address wrote it, so the bar can show what the refusal is about. */
  const bad = useMemo((): BadValues => {
    if (parsed.ok) return {};
    return Object.fromEntries(parsed.issues.map((issue) => [issue.path[0], params.get(issue.path[0] as string) ?? '']));
  }, [parsed, params]);
  /** Everything that did parse: one bad parameter blanks itself, never the other three. */
  const filter = useMemo((): TicketFilter => {
    if (parsed.ok) return parsed.filter;
    const kept = Object.fromEntries(FILTER_PARAMS.filter((name) => !(name in bad)).map((name) => [name, params.get(name) ?? undefined]));
    const again = parseTicketFilter(kept, { slugs: true });
    return again.ok ? again.filter : {};
  }, [parsed, bad, params]);
  const columns = filter.status ?? DEFAULT_BOARD_STATUSES;
  /**
   * The wire always names the status set the board actually draws, even when
   * the address leaves it out — the API's own default is every status, so
   * without it the board would fetch `cancelled` tickets and drop them, and
   * the tile subtitle would count what is not on screen.
   */
  const search = useMemo(
    () => (parsed.ok ? serialiseTicketFilter({ ...parsed.filter, status: [...columns] }) : rawFilterSearch(params)),
    [parsed, params, columns],
  );
  /** Whether anything is filtered at all, which the wire's status set can no longer say. */
  const filtered = serialiseTicketFilter(filter) !== '';

  const tickets = useTicketList(search, true);
  const names = useNames();
  const at = useMinute();
  const { view, toggle } = useView();
  const [menu, setMenu] = useState(false);
  const create = useBoardCreate(filter, columns);
  const cards = tickets.data;
  const lookup = useCallback((key: string) => cards?.find((t) => t.key === key), [cards]);
  const { dragging, refusal, pending, cancel, press, refuse } = useBoardMoves(lookup);
  useKey('v', useCallback(() => setMenu((m) => !m), []));

  /** The board as the Cursor sees it: one column of keys per status drawn, in the order they are drawn. */
  const drawn = useMemo(() => columns.map((status) => (tickets.data ?? []).filter((t) => t.status === status)), [columns, tickets.data]);
  const byKey = useMemo(() => drawn.map((column) => column.map((t) => t.key)), [drawn]);
  const cursor = useCursor({ tile: 'board', columns: byKey, pathOf: (key) => ticketPath({ key }) });
  const under = cursor.at === null ? undefined : lookup(cursor.at);

  const patch = usePatchTicket();
  const intent = useTicketIntent();
  /** Every keyed write reports its refusal where the Cursor is, which is the slot the same act's button would use. */
  const inColumn = (status: TicketStatus, write: () => Promise<unknown>) => void write().catch((e) => refuse({ status, text: refusalLine(e) }));

  // `a s d` and the palette's actions act on the card under the Cursor, through the moves above
  useOffersTicket(
    under === undefined
      ? null
      : {
          key: under.key,
          move: (name) => press(under, name),
          trash: () => inColumn(under.status, () => intent.mutateAsync({ key: under.key, intent: 'trash' })),
          simple: (simple) => inColumn(under.status, () => patch.mutateAsync({ key: under.key, body: { simple } })),
          // `d` goes where the button is and presses it: the picker is open when the Ticket view arrives
          blockedBy: () => navigate(ticketPath(under), { state: { picking: 'depends_on' } }),
          place: (field, id) =>
            inColumn(under.status, () => patch.mutateAsync({ key: under.key, body: field === 'app_id' ? { app_id: id, project_id: null } : { project_id: id } })),
        },
  );

  // `esc` closes what is open — the view menu, the create row — then lets the Cursor go; the shell walks back from there
  useEscape(() => {
    if (menu) {
      setMenu(false);
      return true;
    }
    if (create.close) {
      create.close();
      return true;
    }
    if (cursor.at === null) return false;
    cursor.set(null);
    return true;
  });

  const write = useCallback(
    (next: TicketFilter) => {
      const qs = serialiseTicketFilter(next);
      navigate({ search: qs === '' ? '' : `?${qs}` }, { replace: true });
    },
    [navigate],
  );

  const meta = (t: Ticket) => homeLine(t.app_id === null ? null : names.app(t.app_id), t.project_id === null ? null : names.project(t.project_id));
  const problem = tickets.error === null ? null : tickets.error instanceof ProblemError ? tickets.error.line : `could not reach the API: ${tickets.error.message}`;

  return (
    <Tile
      label="board"
      subtitle={tickets.data ? String(tickets.data.length) : undefined}
      keys={
        <>
          <Kbd>c</Kbd> new <Kbd>f</Kbd> find <Kbd>v</Kbd> view
          {/* `a` is offered only where the card under the Cursor has that arrow, as the state tile offers it */}
          {under !== undefined && keyedMove(under.status, 'approve').ok && (
            <>
              <Kbd>a</Kbd> approve
            </>
          )}
          <Kbd>s</Kbd> status <Kbd>d</Kbd> deps
        </>
      }
      navigable
      span
      testId="board-tile"
    >
      <FilterBar filter={filter} bad={bad} onChange={write} refusal={problem} />
      {menu && (
        <div className="gf-view-menu" data-testid="view-menu">
          <label className="gf-toggle">
            <input type="checkbox" checked={view.meta} onChange={() => toggle('meta')} /> app / project
          </label>
          <label className="gf-toggle">
            <input type="checkbox" checked={view.updated} onChange={() => toggle('updated')} /> updated
          </label>
        </div>
      )}
      {create.form}
      <div className="gf-cols" data-testid="board">
        {columns.map((status, i) => (
          <Column
            key={status}
            status={status}
            tickets={drawn[i] ?? []}
            cursor={cursor.at}
            meta={view.meta ? meta : undefined}
            updated={view.updated}
            at={at}
            // legal columns are marked, never the illegal ones dimmed (DESIGN.md Components)
            legal={dragging === null ? null : dragging !== status && transitionTo(dragging, status) !== undefined}
            refusal={refusal?.status === status ? refusal.text : null}
            pending={pending?.status === status ? pending : null}
            onCancel={cancel}
          />
        ))}
      </div>
      {tickets.data?.length === 0 && !create.form && <Empty>{filtered ? 'nothing matches this filter' : 'no tickets yet — press c'}</Empty>}
    </Tile>
  );
}

/** Cards are ordered by id ascending, so the 5 s poll never reshuffles them under the pointer. */
function Column({
  status,
  tickets,
  cursor,
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
  /** The key the Cursor is on, wherever on the board it is; at most one column has it. */
  cursor: string | null;
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
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} cursor={t.key === cursor} meta={meta ? meta(t) : null} updated={updated ? t.updated_at : null} at={at} />
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
