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
import { useBranchCopy } from '../branch-copy';
import { commonMoves } from '../bulk';
import { useOffersSelection, useOffersTicket } from '../current';
import { useCursor, useEscape } from '../desk';
import { FilterBar, type BadValues } from '../filters';
import { useKey, useKeyMap } from '../keys';
import { usePatchTicket, useTicketIntent, useTicketList, useTransition } from '../queries';
import { cursorColumns, isExpanded, landing, toggleSection, type Expansion, type Landing, type Orientation } from '../sections';
import { BulkStatus, useBulkAction, useSelecting, type BulkAsk } from '../selecting';
import { EMPTY_SELECTION, isSelected, rangeOrder, rangeTo, selectAll, stepFrom, toggle as toggleSelected } from '../selection';
import { useCrumb, useOpenPalette } from '../shell';
import { TicketCard, asDraggedCard, homeLine, ticketPath, useBoardCreate, useNames, type CardActions, type CardSelect, type DraggedCard } from '../tickets';
import { useTouchDrag } from '../touch-drag';
import { Confirm, Empty, Hint, Kbd, Tile, refusalLine, useMinute, useRefusal } from '../ui';

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

/** Read one per-device preference back, or fall back to its default when the device has none or refuses storage. */
function readStored<T extends object>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>) };
  } catch {
    return fallback;
  }
}

function store(key: string, value: object) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a device that refuses storage still gets the board, just not the memory
  }
}

function useView() {
  const [view, setView] = useState<View>(() => readStored(VIEW_STORAGE_KEY, DEFAULT_VIEW));
  const toggle = (name: keyof View) =>
    setView((current) => {
      const next = { ...current, [name]: !current[name] };
      store(VIEW_STORAGE_KEY, next);
      return next;
    });
  return { view, toggle };
}

/**
 * Which sections of the vertical board are open (issue 11): presentation,
 * remembered per device like the View options and just as separate from the
 * Filter — a folded section is still on the board and still counted.
 */
const SECTIONS_STORAGE_KEY = 'gf.board.sections';

function useExpansion() {
  const [expansion, setExpansion] = useState<Expansion>(() => readStored(SECTIONS_STORAGE_KEY, {}));
  const toggle = useCallback(
    (status: TicketStatus) =>
      setExpansion((current) => {
        const next = toggleSection(current, status);
        store(SECTIONS_STORAGE_KEY, next);
        return next;
      }),
    [],
  );
  /** `show` opens a section on purpose, and that is remembered the way a tap on its heading would be. */
  const expand = useCallback(
    (status: TicketStatus) =>
      setExpansion((current) => {
        if (isExpanded(current, status)) return current;
        const next = { ...current, [status]: true };
        store(SECTIONS_STORAGE_KEY, next);
        return next;
      }),
    [],
  );
  return { expansion, toggle, expand };
}

/**
 * Below this many pixels of tile body the kanban's columns are too cramped
 * to read side by side, and the board stacks them instead (issue 11). It is
 * the board's *own* width that decides — never the desk's column tiers, and
 * never what kind of pointer the device has — so a resized window, a tablet
 * and a phone all get the same answer for the same room. Its columns are at
 * least 180px, so 640px is three of them and change: two and a half is where
 * sweeping sideways starts to cost more than scrolling down.
 */
const VERTICAL_BELOW_PX = 640;
/** What the window's chrome takes off the tile body: the desk's gap either side, the tile's border and padding. */
const CHROME_PX = 62;

function useOrientation(): { orientation: Orientation; ref: (element: HTMLElement | null) => void } {
  const [orientation, setOrientation] = useState<Orientation>(() => (window.innerWidth - CHROME_PX < VERTICAL_BELOW_PX ? 'vertical' : 'horizontal'));
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const measure = () => setOrientation(element.getBoundingClientRect().width < VERTICAL_BELOW_PX ? 'vertical' : 'horizontal');
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(element);
  }, []);
  return { orientation, ref };
}

/**
 * Where a sentence about a move lands (DESIGN.md Components: a refusal is
 * placed where the action was refused). `key` names the card it is about —
 * a menu's or a key's move is about one card — and `null` is the column
 * itself, which is all a drop knows.
 */
interface Slot {
  status: TicketStatus;
  key: string | null;
}

/** One sentence in a slot. */
interface Refusal extends Slot {
  text: string;
}

/** A move the board is holding until the human says yes; same slot as a refusal, with a way through. */
interface Pending extends Refusal {
  go: () => void;
}

/**
 * A move that landed somewhere the reader cannot see (issue 11): in a folded
 * section, or off the board because the Filter leaves that status out. Said
 * where the card *was*, so the reading position is kept, with a way to it.
 */
interface Notice {
  key: string;
  from: TicketStatus;
  to: TicketStatus;
  landing: Exclude<Landing, 'shown'>;
}

/**
 * Every way the board moves a card, in one place, because they must agree:
 * dragging a card between columns *is* a transition (CONTEXT.md), and so is
 * pressing the key for one, or choosing it from the card's menu. The move is
 * looked up in the table, applied optimistically, and put back with the API's
 * `hint` if it is refused; a move the table has no arrow for is refused here,
 * in words, without a round trip.
 *
 * They differ only in which slot the sentence lands in — the column you
 * dropped on, or the card the key or the menu was about.
 */
function useBoardMoves(lookup: (key: string) => Ticket | undefined, onMoved: (card: DraggedCard, to: TicketStatus) => void, heldLine: (key: string) => string | null) {
  const move = useTransition();
  const [dragging, setDragging] = useState<TicketStatus | null>(null);
  const { refusal, setRefusal } = useRefusal<Refusal>();
  const [pending, setPending] = useState<Pending | null>(null);
  const moved = useRef(onMoved);
  /** Whether a bulk action holds this card *now* — asked when the move goes, not when it was first pressed: a question may have stood open meanwhile. */
  const held = useRef(heldLine);
  useEffect(() => {
    moved.current = onMoved;
    held.current = heldLine;
  }, [onMoved, heldLine]);

  const run = useCallback(
    (card: DraggedCard, edge: Transition | undefined, slot: Slot, structural: string) => {
      setPending(null);
      if (!edge) return setRefusal({ ...slot, text: structural });
      const go = () => {
        setPending(null);
        const line = held.current(card.key);
        // after this click has finished bubbling: a refusal clears itself on the next click it hears (`useRefusal`),
        // and said inside the click that caused it, that would be this one
        if (line !== null) return void setTimeout(() => setRefusal({ ...slot, text: line }));
        move.mutate(
          { key: card.key, name: edge.name, to: edge.to },
          { onError: (error) => setRefusal({ ...slot, text: refusalLine(error) }), onSuccess: () => moved.current(card, edge.to) },
        );
      };
      const ticket = lookup(card.key);
      if (ticket && asksBeforeBlocked(edge.name, ticket)) return setPending({ ...slot, text: blockedWarning(ticket.blocked_by), go });
      go();
    },
    [lookup, move, setRefusal],
  );

  /** The drop: the column names the edge, and a column with no arrow says so instead of swallowing the gesture. */
  const drop = useCallback(
    (card: DraggedCard, to: TicketStatus) => {
      setPending(null);
      if (card.status === to) return; // a card dropped back where it came from has not moved — position in a column means nothing
      run(card, transitionTo(card.status, to), { status: to, key: null }, structuralRefusal(card.status, to));
    },
    [run],
  );

  /** A key or a menu row: the verb is named, so the refusal is about the arrow that is missing, said under the card. */
  const press = useCallback(
    (card: DraggedCard, name: TransitionName) => {
      const asked = keyedMove(card.status, name);
      run(card, asked.ok ? asked.edge : undefined, { status: card.status, key: card.key }, asked.ok ? '' : asked.refusal);
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

  return { dragging, setDragging, refusal, pending, drop, press, refuse: setRefusal, cancel: useCallback(() => setPending(null), []) };
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
  const { expansion, toggle: toggleExpanded, expand } = useExpansion();
  const { orientation, ref: measured } = useOrientation();
  const vertical = orientation === 'vertical';
  const [menu, setMenu] = useState(false);
  const create = useBoardCreate(filter, columns);
  const find = useRef<(() => void) | null>(null);
  const cards = tickets.data;
  const lookup = useCallback((key: string) => cards?.find((t) => t.key === key), [cards]);

  /** Where the last move landed, when that was somewhere the reader cannot see. */
  const [notice, setNotice] = useState<Notice | null>(null);
  // a press anywhere but on the notice itself lets it go — like a refusal, but with no timer, since it carries a button
  useEffect(() => {
    if (notice === null) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.gf-notice'))) setNotice(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [notice]);
  const onMoved = useCallback(
    (card: DraggedCard, to: TicketStatus) => {
      const where = landing({ to, columns, vertical, expansion });
      setNotice(where === 'shown' ? null : { key: card.key, from: card.status, to, landing: where });
    },
    [columns, vertical, expansion],
  );
  const selecting = useSelecting();
  const { selection, change, keepOnly, pending: sending } = selecting;
  const heldLine = useCallback(
    (key: string) => {
      const ticket = lookup(key);
      return ticket !== undefined && sending?.ids.has(ticket.id) ? `${key} is held by a bulk action — ${sending.label}` : null;
    },
    [lookup, sending],
  );
  const { dragging, setDragging, refusal, pending, drop, press, refuse, cancel } = useBoardMoves(lookup, onMoved, heldLine);
  useKey('v', useCallback(() => setMenu((m) => !m), []));

  /** The board as the Cursor sees it: one column per status drawn — or, stacked, one column of what is open (sections.ts). */
  const drawn = useMemo(() => columns.map((status) => ({ status, tickets: (tickets.data ?? []).filter((t) => t.status === status) })), [columns, tickets.data]);
  const byKey = useMemo(() => cursorColumns(orientation, drawn.map((column) => ({ status: column.status, keys: column.tickets.map((t) => t.key) })), expansion), [orientation, drawn, expansion]);
  const cursor = useCursor({ tile: 'board', columns: byKey, pathOf: (key) => ticketPath({ key }) });
  const under = cursor.at === null ? undefined : lookup(cursor.at);
  const branchCopy = useBranchCopy(under);

  /**
   * The Selection (issue 03b). It belongs to the *filtered* board, not to what
   * is on screen: a folded section's Tickets stay in it and are counted, and
   * whatever a poll or a Filter change takes off the board leaves it. It is
   * the shell's state, so opening a Ticket and coming back keeps it.
   */
  useEffect(() => {
    if (cards) keepOnly(new Set(cards.map((t) => t.id)));
  }, [cards, keepOnly]);
  const members = useMemo(() => (cards ?? []).filter((t) => isSelected(selection, t.id)), [cards, selection]);
  /** The order a range runs in: lifecycle columns, top to bottom, folded sections left out (selection.ts). */
  const order = useMemo(
    () => rangeOrder(drawn.map((column) => ({ status: column.status, ids: column.tickets.map((t) => t.id) })), (status) => !vertical || isExpanded(expansion, status)),
    [drawn, vertical, expansion],
  );
  const select = (t: Ticket, range: boolean) => change((current) => (range ? rangeTo(current, order, t.id) : toggleSelected(current, t.id)));
  const selectEverything = () => change((current) => selectAll(current, (cards ?? []).map((t) => t.id)));
  const clearSelection = () => change(() => EMPTY_SELECTION);
  /** `⇧↓ ⇧↑`: the range's far end takes one step along that same order, and the Cursor goes with it so you can see where it is. */
  const extend = (step: 1 | -1) => {
    const anchored = selection.anchor !== null && order.includes(selection.anchor);
    // with no anchor the press plants one first — on the Cursor's card, else on the first card, where it then stays put
    const plant = anchored ? null : (under?.id ?? order[0] ?? null);
    const target = anchored ? stepFrom(order, under?.id ?? selection.anchor, step) : under ? stepFrom(order, under.id, step) : plant;
    if (target === null) return;
    change((current) => rangeTo(plant === null ? current : rangeTo(current, order, plant), order, target));
    const landed = cards?.find((t) => t.id === target);
    if (landed) cursor.set(landed.key);
  };
  useKey('x', under === undefined ? undefined : () => select(under, false));
  useKeyMap({ ArrowDown: () => extend(1), ArrowUp: () => extend(-1) }, { shift: true });
  // a shifted letter is its own key, so `J K` need no flag: the same aliases the Cursor's arrows have
  useKeyMap({ J: () => extend(1), K: () => extend(-1) });
  useKeyMap({ a: selectEverything }, { meta: true });

  const { report } = selecting;
  /** One action on the whole Selection — from a key, the palette or the bar — and the one question it may have to ask first. */
  const bulk = useBulkAction(members);
  const { act } = bulk;
  useOffersSelection(
    members.length === 0
      ? null
      : {
          members,
          act,
          explainDependencies: () => report({ kind: 'said', text: 'dependencies are declared from one ticket — clear the selection first' }),
        },
  );
  const selectFor = (t: Ticket): CardSelect => ({
    selected: isSelected(selection, t.id),
    onSelect: (range) => select(t, range),
    frozen: sending !== null,
    locked: sending?.ids.has(t.id) ?? false,
  });

  const patch = usePatchTicket();
  const intent = useTicketIntent();
  /** Every keyed or menu write reports its refusal under the card it was about, which is the slot the same act's button would use. */
  const inSlot = (t: Ticket, write: () => Promise<unknown>) => void write().catch((e) => refuse({ status: t.status, key: t.key, text: refusalLine(e) }));
  /** `d` goes where the button is and presses it: the picker is open when the Ticket view arrives. */
  const blockedBy = (t: Ticket) => navigate(ticketPath(t), { state: { picking: 'depends_on' } });

  /** A card's `⋯`: the same verbs, addressed to that card and no other, and the Cursor left where it was (issue 11). */
  const menuFor = (t: Ticket): CardActions => ({
    move: (name) => press(t, name),
    trash: () => inSlot(t, () => intent.mutateAsync({ key: t.key, intent: 'trash' })),
    blockedBy: () => blockedBy(t),
  });

  // `a s d` and the palette's actions act on the card under the Cursor — the card's own verbs, plus what only a key offers
  useOffersTicket(
    under === undefined
      ? null
      : {
          key: under.key,
          ...menuFor(under),
          copyBranch: () => void branchCopy.copy(),
          addImplementationLink: () => navigate(ticketPath(under), { state: { implementation: 'add-link' } }),
          simple: (simple) => inSlot(under, () => patch.mutateAsync({ key: under.key, body: { simple } })),
          place: (field, id) =>
            inSlot(under, () => patch.mutateAsync({ key: under.key, body: field === 'app_id' ? { app_id: id, project_id: null } : { project_id: id } })),
        },
  );

  // `esc` closes what is open — the view menu, the create row, a notice, a question — then lets the Selection go,
  // then the Cursor; the shell walks back from there
  useEscape(() => {
    if (menu) {
      setMenu(false);
      return true;
    }
    if (create.close) {
      create.close();
      return true;
    }
    if (notice !== null) {
      setNotice(null);
      return true;
    }
    if (bulk.question !== null) {
      bulk.cancel();
      return true;
    }
    if (selecting.outcome?.kind === 'refused' || selecting.outcome?.kind === 'unknown') {
      report(null);
      return true;
    }
    // then what you have gathered, and only then where you are; a set that has been sent is not yours to drop
    if (members.length > 0 && sending === null) {
      clearSelection();
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

  /** `show`: open the section the card went to, put the Cursor on it and bring it on screen — on request, never on success alone. */
  const show = useCallback(
    (n: Notice) => {
      setNotice(null);
      if (n.landing === 'off-board') return navigate(ticketPath({ key: n.key }));
      expand(n.to);
      cursor.set(n.key);
      requestAnimationFrame(() => document.querySelector(`.gf-card[data-key="${n.key}"]`)?.scrollIntoView({ block: 'center' }));
    },
    [navigate, expand, cursor],
  );

  /** The touch drag (touch-drag.ts) ends in the same `drop` the mouse drag does. */
  const scroller = useRef<HTMLDivElement>(null);
  // one ref for the kanban: the gesture's scroller and the width that decides the orientation, bound once
  const kanban = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      measured(element);
    },
    [measured],
  );
  const [touchOver, setTouchOver] = useState<TicketStatus | null>(null);
  const lift = useTouchDrag(scroller, !vertical, {
    onLift: (card) => {
      refuse(null);
      cancel();
      setDragging(card.status);
    },
    onOver: setTouchOver,
    onRelease: (card, to) => {
      setDragging(null);
      setTouchOver(null);
      if (to !== null) drop(card, to);
    },
  });

  const meta = (t: Ticket) => homeLine(t.app_id === null ? null : names.app(t.app_id), t.project_id === null ? null : names.project(t.project_id));
  const problem = tickets.error === null ? null : tickets.error instanceof ProblemError ? tickets.error.sentence : `could not reach the API: ${tickets.error.message}`;

  const cardsIn = (column: { status: TicketStatus; tickets: Ticket[] }) => ({
    status: column.status,
    tickets: column.tickets,
    cursor: cursor.at,
    meta: view.meta ? meta : undefined,
    updated: view.updated,
    at,
    menuFor,
    selectFor,
    canDrag: !vertical,
    refusal: refusal?.status === column.status ? refusal : null,
    pending: pending?.status === column.status ? pending : null,
    notice: notice?.from === column.status ? notice : null,
    onCancel: cancel,
    onShow: show,
  });

  return (
    <Tile
      label="board"
      subtitle={tickets.data ? String(tickets.data.length) : undefined}
      keys={
        <>
          <Hint k="c" onClick={create.open} testId="hint-new">
            new
          </Hint>
          <Hint k="f" onClick={() => find.current?.()} testId="hint-find">
            find
          </Hint>
          <Hint k="v" onClick={() => setMenu((m) => !m)} testId="hint-view">
            view
          </Hint>
          {under !== undefined && (
            <>
              <Hint k="x" onClick={() => select(under, false)}>
                select
              </Hint>
              <Hint k="⇧↓">range</Hint>
            </>
          )}
          <Hint k="⌘A" onClick={selectEverything} testId="hint-select-all">
            select all
          </Hint>
          {/* with a Selection the verbs are the selection bar's, addressed to the set; these three are the Cursor's */}
          {members.length === 0 && (
            <>
              {/* `a` is offered only where the card under the Cursor has that arrow, as the state tile offers it */}
              {under !== undefined && keyedMove(under.status, 'approve').ok && (
                <Hint k="a" onClick={() => press(under, 'approve')}>
                  approve
                </Hint>
              )}
              <Hint k="s">status</Hint>
              <Hint k="d" onClick={under === undefined ? undefined : () => blockedBy(under)}>
                deps
              </Hint>
            </>
          )}
        </>
      }
      navigable
      span
      testId="board-tile"
    >
      <FilterBar filter={filter} bad={bad} onChange={write} refusal={problem} findRef={find} />
      {branchCopy.copied && <p className="gf-implementation-notice" role="status">{under?.key} branch name copied</p>}
      {branchCopy.failed && <p className="gf-refusal" role="alert">Couldn’t copy. Copy this branch name manually: <code className="gf-branch-name">{branchCopy.branch}</code></p>}
      {menu && (
        <div className="gf-view-menu" data-testid="view-menu">
          <label className="gf-toggle">
            <input type="checkbox" checked={view.meta} onChange={() => toggle('meta')} /> app / project
          </label>
          <label className="gf-toggle">
            <input type="checkbox" checked={view.updated} onChange={() => toggle('updated')} /> updated
          </label>
          <button type="button" className="gf-filter-clear" aria-label="close view options" onClick={() => setMenu(false)}>
            ×
          </button>
        </div>
      )}
      {create.form}
      {vertical ? (
        <div ref={measured} className="gf-sections" data-testid="board" data-orientation="vertical">
          {drawn.map((column) => (
            <Section key={column.status} {...cardsIn(column)} expanded={isExpanded(expansion, column.status)} onToggle={() => toggleExpanded(column.status)} />
          ))}
        </div>
      ) : (
        <div ref={kanban} className="gf-cols" data-testid="board" data-orientation="horizontal">
          {drawn.map((column) => (
            <Column
              key={column.status}
              {...cardsIn(column)}
              // legal columns are marked, never the illegal ones dimmed (DESIGN.md Components)
              legal={dragging === null ? null : dragging !== column.status && transitionTo(dragging, column.status) !== undefined}
              fingerOver={touchOver === column.status}
            />
          ))}
        </div>
      )}
      {/* after the board and out of its way: a bar that arrived above the cards would move the card you were about to tick
          (DESIGN.md Interaction, the mode line's rule), and at the foot it is under a thumb */}
      <SelectionBar count={members.length} total={cards?.length ?? 0} approvable={commonMoves(members).includes('approve')} bulk={bulk} onSelectAll={selectEverything} onClear={clearSelection} />
      {lift && (
        // the card under the finger, drawn where the finger is; the column marks say where it may go
        <div className="gf-card gf-ghost" style={{ left: lift.x, top: lift.y }} aria-hidden="true" data-testid="ghost">
          <span className="gf-card-id">
            <span className="gf-card-key">{lift.card.key}</span>
          </span>
          <span className="gf-card-title">{lookup(lift.card.key)?.title}</span>
        </div>
      )}
      {tickets.data?.length === 0 && !create.form && <Empty>{filtered ? 'nothing matches this filter' : 'no tickets yet — press c'}</Empty>}
    </Tile>
  );
}

/**
 * The Selection's bar (issue 03b): how many, the two ways to change that
 * without a keyboard, and the three things a Selection can have done to it —
 * every one a button, because a finger has no `a` and no `⌘A`. It is only
 * there while there is something to say: a Selection, an action that is out,
 * or how the last one ended. The count is of the Selection, so a Ticket in a
 * folded section is in it.
 */
function SelectionBar({ count, total, approvable, bulk, onSelectAll, onClear }: { count: number; total: number; approvable: boolean; bulk: BulkAsk; onSelectAll: () => void; onClear: () => void }) {
  const { pending, outcome, report } = useSelecting();
  const openPalette = useOpenPalette();
  const { question, act: onAct, confirm: onConfirm, cancel: onCancel } = bulk;
  const busy = pending !== null;
  if (count === 0 && pending === null && outcome === null) return null;
  return (
    <div className="gf-selection" role="region" aria-label="selection" data-testid="selection-bar">
      {count > 0 && (
        <div className="gf-selection-row">
          {/* announced, because `x` and a shifted arrow change it with nothing else on screen to say so */}
          <span className="gf-selection-count" data-testid="selection-count" aria-live="polite">
            <b>{count}</b> selected
          </span>
          <button type="button" className="gf-btn" data-testid="select-all" disabled={busy || count === total} onClick={onSelectAll}>
            select all
          </button>
          <button type="button" className="gf-btn" data-testid="clear-selection" disabled={busy} onClick={onClear}>
            clear <Kbd>esc</Kbd>
          </button>
          {question === null ? (
            <span className="gf-selection-actions">
              {/* always there, as `a` always answers: on a set that does not share the arrow it refuses with each Ticket's reason */}
              <button type="button" className={`gf-btn${approvable ? ' is-primary' : ''}`} data-testid="bulk-approve" disabled={busy} onClick={() => onAct({ kind: 'transition', name: 'approve' })}>
                approve <Kbd>a</Kbd>
              </button>
              <button type="button" className="gf-btn" data-testid="bulk-status" disabled={busy} onClick={() => openPalette('status')}>
                status… <Kbd>s</Kbd>
              </button>
              <button type="button" className="gf-btn" data-testid="bulk-move" disabled={busy} onClick={() => openPalette('move')}>
                move…
              </button>
              <button type="button" className="gf-btn is-danger" data-testid="bulk-trash" disabled={busy} onClick={() => onAct({ kind: 'trash' })}>
                trash
              </button>
            </span>
          ) : (
            // the question takes the verbs' place: it is asked where the verb was pressed, and no second verb is in reach meanwhile
            <span className="gf-selection-actions" role="alert" data-testid="bulk-confirm">
              <span className="gf-selection-question">{question.text}</span>
              <button type="button" className={`gf-btn${question.danger ? ' is-danger' : ''}`} data-testid="bulk-confirm-yes" onClick={onConfirm}>
                {question.verb}
              </button>
              <button type="button" className="gf-btn" data-testid="bulk-confirm-cancel" onClick={onCancel}>
                cancel <Kbd>esc</Kbd>
              </button>
            </span>
          )}
        </div>
      )}
      {question !== null && question.lines.length > 0 && (
        <ul className="gf-bulk-lines" data-testid="bulk-confirm-lines">
          {question.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <BulkStatus onDismiss={() => report(null)} />
    </div>
  );
}

/** Everything one status's cards need, whichever way the board is drawn. */
interface CardsProps {
  status: TicketStatus;
  tickets: Ticket[];
  /** The key the Cursor is on, wherever on the board it is; at most one column has it. */
  cursor: string | null;
  meta: ((t: Ticket) => string) | undefined;
  updated: boolean;
  at: number;
  menuFor: (t: Ticket) => CardActions;
  selectFor: (t: Ticket) => CardSelect;
  canDrag: boolean;
  /** The sentence filed under this status, if any: under its card when it names one that is here, else at the foot. */
  refusal: Refusal | null;
  /** A move this status is holding until the human confirms it. */
  pending: Pending | null;
  /** A card that left this status for somewhere out of sight. */
  notice: Notice | null;
  onCancel: () => void;
  onShow: (notice: Notice) => void;
}

/** What the board has to say under a card, or at the foot of its column. */
function Said({ status, refusal, pending, notice, onCancel, onShow }: Pick<CardsProps, 'status' | 'refusal' | 'pending' | 'notice' | 'onCancel' | 'onShow'>) {
  return (
    <>
      {refusal && (
        <p className="gf-refusal gf-col-refusal" role="alert" data-testid={`refusal-${status}`}>
          {refusal.text}
        </p>
      )}
      {pending && <Confirm text={pending.text} verb="start" onConfirm={pending.go} onCancel={onCancel} testId={`confirm-${status}`} />}
      {notice && (
        <p className="gf-confirm gf-notice" role="status" data-testid={`notice-${status}`}>
          <span>
            {notice.key} moved to {notice.to}
            {notice.landing === 'off-board' ? ', which this filter leaves off' : ''}
          </span>
          <button type="button" className="gf-btn" data-testid="notice-show" onClick={() => onShow(notice)}>
            {notice.landing === 'off-board' ? 'open' : 'show'}
          </button>
        </p>
      )}
    </>
  );
}

/** Cards are ordered by id ascending, so the 5 s poll never reshuffles them under the pointer. */
function Cards({ status, tickets, cursor, meta, updated, at, menuFor, selectFor, canDrag, refusal, pending, notice, onCancel, onShow }: CardsProps) {
  /** A sentence about a card that is here goes under that card; anything else goes at the foot. */
  const under = (key: string) => ({
    refusal: refusal?.key === key ? refusal : null,
    pending: pending?.key === key ? pending : null,
  });
  const here = new Set(tickets.map((t) => t.key));
  const atFoot = (said: Slot | null) => said !== null && (said.key === null || !here.has(said.key));
  return (
    <>
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} cursor={t.key === cursor} meta={meta ? meta(t) : null} updated={updated ? t.updated_at : null} at={at} menu={menuFor(t)} select={selectFor(t)} canDrag={canDrag}>
          <Said status={status} {...under(t.key)} notice={null} onCancel={onCancel} onShow={onShow} />
        </TicketCard>
      ))}
      <Said status={status} refusal={atFoot(refusal) ? refusal : null} pending={atFoot(pending) ? pending : null} notice={notice} onCancel={onCancel} onShow={onShow} />
    </>
  );
}

/** One column of the kanban: a drop target, marked while a drag is live. */
function Column({
  legal,
  fingerOver,
  ...cards
}: CardsProps & {
  /** `null` when no drag is live; otherwise whether the dragged card has an arrow here. */
  legal: boolean | null;
  /** The touch drag's finger is over this column; the mouse drag reports its own. */
  fingerOver: boolean;
}) {
  const { status, tickets } = cards;
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
    <div ref={ref} className={`gf-col${marks}${over || fingerOver ? ' is-over' : ''}`} data-testid={`col-${status}`} data-status={status}>
      <div className="gf-col-head">
        {status}
        <b>{tickets.length}</b>
      </div>
      <Cards {...cards} />
    </div>
  );
}

/**
 * One section of the stacked board (issue 11): the column head as a button
 * that folds and unfolds it, the count always on show. A folded section keeps
 * whatever the board is saying about it — a question must not fold away with
 * the card it is about.
 */
function Section({ expanded, onToggle, ...cards }: CardsProps & { expanded: boolean; onToggle: () => void }) {
  const { status, tickets, refusal, pending, notice, onCancel, onShow } = cards;
  return (
    <section className={`gf-section${expanded ? ' is-open' : ''}`} data-testid={`section-${status}`} data-status={status} aria-label={status}>
      <button type="button" className="gf-col-head gf-section-head" aria-expanded={expanded} data-testid={`section-head-${status}`} onClick={onToggle}>
        <span>
          <span className="gf-section-mark" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          {status}
        </span>
        <b>{tickets.length}</b>
      </button>
      {expanded ? <Cards {...cards} /> : <Said status={status} refusal={refusal} pending={pending} notice={notice} onCancel={onCancel} onShow={onShow} />}
    </section>
  );
}
