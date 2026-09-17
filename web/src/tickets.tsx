import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { CREATABLE_STATUSES, destinationOf, isBlocked, isCreatable, type CreateTicketBody, type Ticket, type TicketFilter, type TicketStatus, type TransitionName } from '@goblin/shared';
import { useOpensCreate } from './creating';
import { useCursor } from './desk';
import { formKeys, useKey } from './keys';
import { rankedMoves } from './palette';
import { useCreateTicket, useApps, useProjects } from './queries';
import { Chip, Empty, Kbd, Since, refusalLine, useCloseOnOutside, type Namer, type Tone } from './ui';

/**
 * Status → meaning (DESIGN.md Colors). `backlog/todo/planning` are all "not yet
 * real" — the column header, not the colour, tells them apart. `building` is
 * `system` while it is built by hand; it turns `live` when a run exists (S5).
 */
const TONE: Record<TicketStatus, Tone> = {
  backlog: 'draft',
  todo: 'draft',
  planning: 'draft',
  ready: 'system',
  building: 'system',
  review: 'review',
  done: 'mute',
  cancelled: 'mute',
};

export const statusTone = (status: TicketStatus) => TONE[status];

export const ticketPath = (t: { key: string }) => `/tickets/${t.key}`;

/** Where a ticket lives, as `app / project` — a lone `—` for an orphan (DESIGN.md Interaction). */
export const homeLine = (app: string | null, project: string | null) => (app === null && project === null ? '—' : `${app ?? '—'} / ${project ?? '—'}`);

/** Names for the meta line and the history, from the cached lists; `#3` once a thing is gone. */
export function useNames(): { app: Namer; project: Namer } {
  const apps = useApps(true);
  const projects = useProjects({ archived: true });
  return {
    app: (id) => apps.data?.find((a) => a.id === id)?.name ?? `#${String(id)}`,
    project: (id) => projects.data?.find((p) => p.id === id)?.name ?? `#${String(id)}`,
  };
}

export const StatusChip = ({ status }: { status: TicketStatus }) => (
  <Chip tone={statusTone(status)} struck={status === 'cancelled'}>
    {status}
  </Chip>
);

/** What a dragged card puts on the wire; the board reads it to pick the edge. */
export interface DraggedCard {
  key: string;
  status: TicketStatus;
}

/** A drag payload is only ours if it carries both fields; anything else the monitor ignores. */
export const asDraggedCard = (data: Record<string | symbol, unknown>): DraggedCard | null =>
  typeof data.key === 'string' && typeof data.status === 'string' ? { key: data.key, status: data.status as TicketStatus } : null;

/** What a card's menu can do to its own Ticket — the board's verbs, addressed to this card and no other (issue 11). */
export interface CardActions {
  move: (name: TransitionName) => void;
  trash: () => void;
  blockedBy: () => void;
}

/** A card's part in the Selection (issue 03b): whether it is in, how it gets in or out, and whether any of that is on hold. */
export interface CardSelect {
  selected: boolean;
  /** The checkbox, or a shift-click anywhere on the card; `range` is whether shift was down. */
  onSelect: (range: boolean) => void;
  /** A bulk action is out: the Selection is frozen until it answers. */
  frozen: boolean;
  /** This Ticket is in the submitted set, so nothing else may write to it meanwhile — no menu, no drag. */
  locked: boolean;
}

/**
 * The kanban card: key + status note, title, then whatever the view options
 * ask for (DESIGN.md Components). The card is a link and the whole of it is
 * the drag handle; the `⋯` beside it is the menu (issue 11), a sibling rather
 * than a child so a link never contains a button. Whatever the board has to
 * say *about* this card — a refusal, a question, where it went — goes under it.
 */
export function TicketCard({
  ticket,
  cursor,
  meta,
  updated,
  at,
  menu,
  select,
  canDrag,
  children,
}: {
  ticket: Ticket;
  /** The Cursor is on this card: the selected-row mark, never the full border, which is the drag's. */
  cursor: boolean;
  meta: string | null;
  updated: string | null;
  at: number;
  menu: CardActions;
  select: CardSelect;
  /** Only a horizontal board drags (issue 11): stacked sections move a card through its menu. */
  canDrag: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [lifted, setLifted] = useState(false);
  // the whole card is the drag handle — no grip (DESIGN.md Components)
  useEffect(() => {
    const element = ref.current;
    if (!element || !canDrag || select.locked) return;
    return draggable({
      element,
      getInitialData: (): Record<string, unknown> => ({ key: ticket.key, status: ticket.status }),
      onDragStart: () => setLifted(true),
      onDrop: () => setLifted(false),
    });
  }, [ticket.key, ticket.status, canDrag, select.locked]);

  // blocked is a derived condition, never a colour: the outline glyph and the strike, nothing else (DESIGN.md Colors)
  const blocked = isBlocked(ticket);
  return (
    <div className="gf-card-slot">
      {/* a sibling of the link, like the menu: ticking a card never opens it, and a finger needs no long-press to reach it.
          First in the slot because it is first on the card: the tab order follows the eye */}
      <input
        type="checkbox"
        className="gf-card-check"
        aria-label={`select ${ticket.key}`}
        data-testid={`select-${ticket.key}`}
        // it takes no text, so the board's keys work past it while it holds the focus (keys.tsx)
        data-passes-keys=""
        checked={select.selected}
        disabled={select.frozen}
        onChange={(e) => select.onSelect((e.nativeEvent as MouseEvent).shiftKey === true)}
      />
      <Link
        ref={ref}
        className={`gf-card is-${statusTone(ticket.status)}${ticket.status === 'cancelled' ? ' is-cancelled' : ''}${blocked ? ' is-blocked' : ''}${lifted ? ' is-lifted' : ''}${cursor ? ' is-cursor' : ''}${select.selected ? ' is-selected' : ''}`}
        to={ticketPath(ticket)}
        aria-current={cursor ? true : undefined}
        // shift-click gathers a range and goes nowhere; every other click still opens the Ticket
        onClick={(e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          select.onSelect(true);
        }}
        data-testid={`card-${ticket.key}`}
        // what the touch drag reads off the card it landed on (touch-drag.ts)
        data-key={ticket.key}
        data-status={ticket.status}
        data-locked={select.locked ? '' : undefined}
      >
        <span className="gf-card-id">
          <span className="gf-card-key">{ticket.key}</span>
          <i>{ticket.status}</i>
        </span>
        <span className="gf-card-title">
          {blocked && (
            <span className="gf-blocked-mark" title={`blocked by ${ticket.blocked_by.join(', ')}`} data-testid={`blocked-${ticket.key}`}>
              ◇
            </span>
          )}
          {ticket.title}
        </span>
        {meta !== null && <span className="gf-card-meta">{meta}</span>}
        {updated !== null && (
          <span className="gf-card-meta">
            updated <Since iso={updated} at={at} />
          </span>
        )}
      </Link>
      <CardMenu ticket={ticket} actions={menu} disabled={select.locked} />
      {children}
    </div>
  );
}

/**
 * `⋯` on a card (issue 11): the state tile's arrows and the ways of stopping,
 * for this Ticket alone. It never moves the Cursor — a menu that changed what
 * `a s d` point at would make a tap do two things — and it reads the same
 * table the drag and the keys read, so it cannot offer a move they refuse.
 * Forward moves first, as the palette ranks them; `cancel` and `trash` apart,
 * as the state tile sets them.
 */
function CardMenu({ ticket, actions, disabled }: { ticket: Ticket; actions: CardActions; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnOutside(slot, open, close);
  /** Whether the panel hangs above the button instead of below it: it must fit the screen it is on. */
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const box = panel.current.getBoundingClientRect();
    // the visual viewport: on a phone the layout viewport can be taller than what is actually on screen
    const seen = window.visualViewport?.height ?? window.innerHeight;
    setUp(box.bottom > seen && box.height < box.top);
    // the keys land on the first row; the page must not move for a menu that opened under a tap
    panel.current.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) setUp(false);
  }, [open]);

  const run = (act: () => void) => {
    setOpen(false);
    act();
  };
  const verbs = rankedMoves(ticket.status);
  // `close` skips the lifecycle to `done`: in a tapped menu it goes last among the arrows, against the separator,
  // so a thumb that slips off the first row lands on a lateral move and not on an ending
  const moves = [...verbs.filter((name) => name !== 'cancel' && name !== 'close'), ...verbs.filter((name) => name === 'close')];
  const cancel = verbs.includes('cancel');

  return (
    <div className="gf-card-menu-slot" ref={slot}>
      <button
        type="button"
        className="gf-card-menu-btn"
        aria-label={`actions for ${ticket.key}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`menu-${ticket.key}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={panel}
          className={`gf-pop gf-card-menu${up ? ' is-up' : ''}`}
          role="menu"
          aria-label={`actions for ${ticket.key}`}
          data-testid={`card-menu-${ticket.key}`}
          // the keys belong to the menu while it is open: `↑↓` walk its rows, `esc` closes it, and none of
          // them reach the board's own map — `⏎` on a row must not also open the card under the Cursor
          onKeyDown={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const rows = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
              const at = rows.indexOf(document.activeElement as HTMLElement);
              rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus({ preventScroll: true });
            }
          }}
        >
          <div className="gf-menu-group">
            {moves.map((name) => (
              <button key={name} type="button" role="menuitem" className="gf-menu-item" data-testid={`menu-${ticket.key}-${name}`} onClick={() => run(() => actions.move(name))}>
                {name}
                <span className="gf-menu-note">{destinationOf(name)}</span>
              </button>
            ))}
            <button type="button" role="menuitem" className="gf-menu-item" data-testid={`menu-${ticket.key}-blocked-by`} onClick={() => run(actions.blockedBy)}>
              blocked by…
            </button>
          </div>
          <div className="gf-menu-group is-separated">
            {cancel && (
              <button type="button" role="menuitem" className="gf-menu-item is-danger" data-testid={`menu-${ticket.key}-cancel`} onClick={() => run(() => actions.move('cancel'))}>
                cancel
              </button>
            )}
            <button type="button" role="menuitem" className="gf-menu-item is-danger" data-testid={`menu-${ticket.key}-trash`} onClick={() => run(actions.trash)}>
              trash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `c` creates a ticket wherever there is a scope (DESIGN.md Interaction): the board
 * passes none, an App or Project view passes its own. Returns the form to
 * render — `null` when nobody has pressed `c` — and the opener, for the hint
 * that is also a button (issue 11).
 */
export function useNewTicket(scope: { app_id?: number; project_id?: number }, testId = 'new-ticket') {
  const [open, setOpen] = useState(false);
  const create = useCreateTicket();
  const start = useCallback(() => setOpen(true), []);
  useKey('c', start);
  useOpensCreate('ticket', start);
  const { app_id, project_id } = scope;

  const form = open ? (
    <NewTicket
      testId={testId}
      onCancel={() => setOpen(false)}
      onCreate={async (title) => {
        await create.mutateAsync({ title, ...(app_id === undefined ? {} : { app_id }), ...(project_id === undefined ? {} : { project_id }) });
        setOpen(false);
      }}
    />
  ) : null;
  return { form, open: start };
}

/** Where a ticket the board makes starts: the first status in the Filter it may be *created* in, else `backlog`. */
const createStatusFor = (statuses: readonly TicketStatus[]): TicketStatus => statuses.find(isCreatable) ?? 'backlog';

/**
 * ADR-0007's question, asked once: may this project sit under this app? Both
 * places that choose an app and a project side by side — the board's filter
 * chips and its create row — drop the project when the answer is no.
 */
export const projectFitsApp = (project: { app_id: number | null } | undefined, app_id: number | null): boolean => project?.app_id === app_id;

/**
 * `c` on the board (issue 06): one row under the filter bar, prefilled from
 * the Filter — the Scope on screen (CONTEXT.md "Scope"). Every field is
 * editable before saving, so the ticket lands where you sent it, on this board
 * or off it.
 */
export function useBoardCreate(filter: TicketFilter, statuses: readonly TicketStatus[]) {
  const [open, setOpen] = useState(false);
  const start = useCallback(() => setOpen(true), []);
  useKey('c', start);
  useOpensCreate('ticket', start);
  // `close` doubles as "is it open": `esc` closes the topmost thing, and the row is one of them
  return {
    form: open ? <BoardCreate filter={filter} statuses={statuses} onDone={() => setOpen(false)} /> : null,
    close: open ? () => setOpen(false) : null,
    open: start,
  };
}

const idOf = (value: string): number | null => (value === '' ? null : Number(value));

function BoardCreate({ filter, statuses, onDone }: { filter: TicketFilter; statuses: readonly TicketStatus[]; onDone: () => void }) {
  // an archived app or project is not somewhere a new ticket may go, so the row offers only live ones
  const apps = useApps();
  const projects = useProjects();
  const create = useCreateTicket();
  const [title, setTitle] = useState('');
  const [app, setApp] = useState<number | null>(typeof filter.app_id === 'number' ? filter.app_id : null);
  const [project, setProject] = useState<number | null>(typeof filter.project_id === 'number' ? filter.project_id : null);
  const [status, setStatus] = useState<TicketStatus>(() => createStatusFor(statuses));
  const [simple, setSimple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /** ADR-0007 while you are still typing: a project brings its app, and moving the app drops a project that is not in it. */
  const chooseProject = (id: number | null) => {
    setProject(id);
    const chosen = projects.data?.find((p) => p.id === id);
    if (chosen) setApp(chosen.app_id);
  };
  const chooseApp = (id: number | null) => {
    setApp(id);
    if (!projectFitsApp(projects.data?.find((p) => p.id === project), id)) setProject(null);
  };

  const save = async () => {
    if (busy.current || !title.trim()) return;
    busy.current = true;
    setError(null);
    try {
      // a project already carries its app; sending both would be a contradiction the API is right to refuse
      const placement = project === null ? { app_id: app } : { project_id: project };
      await create.mutateAsync({ title: title.trim(), status, simple, ...placement } satisfies CreateTicketBody);
      onDone();
    } catch (e) {
      setError(refusalLine(e));
    } finally {
      busy.current = false;
    }
  };

  // a project already names its app, so the row never opens saying `no app` beside a project (ADR-0007)
  const shownApp = project === null ? app : (projects.data?.find((p) => p.id === project)?.app_id ?? app);
  const inProject = projects.data?.filter((p) => shownApp === null || p.app_id === shownApp) ?? [];
  return (
    <div className="gf-new-row" data-testid="board-create" onKeyDown={formKeys(() => void save(), onDone)}>
      <input
        autoFocus
        className="gf-new-row-title"
        type="text"
        aria-label="ticket title"
        placeholder="new ticket"
        autoComplete="off"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <select aria-label="app" value={shownApp === null ? '' : String(shownApp)} onChange={(e) => chooseApp(idOf(e.target.value))}>
        <option value="">no app</option>
        {apps.data?.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select aria-label="project" value={project === null ? '' : String(project)} onChange={(e) => chooseProject(idOf(e.target.value))}>
        <option value="">no project</option>
        {inProject.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select aria-label="status" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
        {CREATABLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label className="gf-toggle">
        <input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} /> simple
      </label>
      <FormButtons onSave={() => void save()} onCancel={onDone} />
      {error && (
        <p className="gf-refusal gf-new-row-refusal" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** `save` and `cancel` as buttons that carry their keys (issue 11): a hint is not a control, and a finger has no `⌘⏎`. */
const FormButtons = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => (
  <span className="gf-form-actions gf-new-ticket-keys">
    <button type="button" className="gf-btn is-primary" data-testid="form-save" onClick={onSave}>
      save <Kbd>⌘⏎</Kbd>
    </button>
    <button type="button" className="gf-btn" data-testid="form-cancel" onClick={onCancel}>
      cancel <Kbd>esc</Kbd>
    </button>
  </span>
);

/**
 * A ticket from a title alone. One line, because at this point the ticket is
 * only an idea (CONTEXT.md).
 */
export function NewTicket({ onCreate, onCancel, testId }: { onCreate: (title: string) => Promise<unknown>; onCancel: () => void; testId?: string }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const save = async () => {
    if (busy.current || !title.trim()) return;
    busy.current = true;
    setError(null);
    try {
      await onCreate(title.trim());
    } catch (e) {
      setError(refusalLine(e));
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="gf-new-ticket" data-testid={testId}>
      <input
        autoFocus
        type="text"
        aria-label="ticket title"
        placeholder="new ticket"
        autoComplete="off"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={formKeys(() => void save(), onCancel)}
      />
      <FormButtons onSave={() => void save()} onCancel={onCancel} />
      {error && (
        <p className="gf-refusal" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The `tickets` tile of an App or Project view: key, title, status. `j/k` move
 * the Cursor down the rows and `⏎` opens one; there is nothing else here for a
 * key to do, because there is no other button on the row (issue 10).
 */
export function TicketRows({ tickets, tile = 'tickets' }: { tickets: Ticket[] | undefined; tile?: string }) {
  const cursor = useCursor({ tile, columns: [(tickets ?? []).map((t) => t.key)], pathOf: (key) => ticketPath({ key }) });
  if (!tickets) return <Empty>loading…</Empty>;
  if (tickets.length === 0) return <Empty>no tickets — press c</Empty>;
  return (
    <div className="gf-rows" data-testid="ticket-rows">
      {tickets.map((t) => (
        <Link key={t.id} className={`gf-row${cursor.isAt(t.key) ? ' is-cursor' : ''}`} aria-current={cursor.isAt(t.key) ? true : undefined} to={ticketPath(t)}>
          <span className="gf-row-title">
            <span className="gf-key">{t.key}</span> {t.title}
          </span>
          <span className="gf-row-trail">
            <StatusChip status={t.status} />
          </span>
        </Link>
      ))}
    </div>
  );
}
