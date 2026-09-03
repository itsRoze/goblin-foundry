import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { isBlocked, type Ticket, type TicketStatus } from '@goblin/shared';
import { ProblemError } from './api';
import { formKeys } from './keys';
import { useCreateTicket, useApps, useProjects } from './queries';
import { useKey } from './keys';
import { Chip, Empty, Kbd, Since, type Namer, type Tone } from './ui';

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

/** The kanban card: key + status note, title, then whatever the view options ask for (DESIGN.md Components). */
export function TicketCard({ ticket, meta, updated, at }: { ticket: Ticket; meta: string | null; updated: string | null; at: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [lifted, setLifted] = useState(false);
  // the whole card is the drag handle — no grip (DESIGN.md Components)
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return draggable({
      element,
      getInitialData: (): Record<string, unknown> => ({ key: ticket.key, status: ticket.status }),
      onDragStart: () => setLifted(true),
      onDrop: () => setLifted(false),
    });
  }, [ticket.key, ticket.status]);

  // blocked is a derived condition, never a colour: the outline glyph and the strike, nothing else (DESIGN.md Colors)
  const blocked = isBlocked(ticket);
  return (
    <Link
      ref={ref}
      className={`gf-card is-${statusTone(ticket.status)}${ticket.status === 'cancelled' ? ' is-cancelled' : ''}${blocked ? ' is-blocked' : ''}${lifted ? ' is-lifted' : ''}`}
      to={ticketPath(ticket)}
      data-testid={`card-${ticket.key}`}
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
  );
}

/**
 * `c` creates a ticket wherever there is a scope (DESIGN.md Interaction): the board
 * passes none, an App or Project view passes its own. Returns the form to
 * render, or `null` when nobody has pressed `c`.
 */
export function useNewTicket(scope: { app_id?: number; project_id?: number }, testId = 'new-ticket') {
  const [open, setOpen] = useState(false);
  const create = useCreateTicket();
  useKey('c', useCallback(() => setOpen(true), []));
  const { app_id, project_id } = scope;

  if (!open) return null;
  return (
    <NewTicket
      testId={testId}
      onCancel={() => setOpen(false)}
      onCreate={async (title) => {
        await create.mutateAsync({ title, ...(app_id === undefined ? {} : { app_id }), ...(project_id === undefined ? {} : { project_id }) });
        setOpen(false);
      }}
    />
  );
}

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
      setError(e instanceof ProblemError ? e.line : String(e));
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
      <span className="gf-new-ticket-keys">
        <Kbd>⌘⏎</Kbd> save <Kbd>esc</Kbd> cancel
      </span>
      {error && (
        <p className="gf-refusal" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The `tickets` tile of an App or Project view: key, title, status. */
export function TicketRows({ tickets }: { tickets: Ticket[] | undefined }) {
  if (!tickets) return <Empty>loading…</Empty>;
  if (tickets.length === 0) return <Empty>no tickets — press c</Empty>;
  return (
    <div className="gf-rows" data-testid="ticket-rows">
      {tickets.map((t) => (
        <Link key={t.id} className="gf-row" to={ticketPath(t)}>
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
