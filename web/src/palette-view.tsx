import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isTerminal, slugPath, type TicketDetail } from '@goblin/shared';
import { useCurrentTicket } from './current';
import { useCreate } from './creating';
import { commonMoves, countOf } from './bulk';
import { paletteHits, selectionMoveRows, selectionPlaceRows, selectionRows, selectionTransitionRows, transitionRows, type Candidate, type PaletteAction } from './palette';
import { useApps, useProjects, useTicket, useTickets } from './queries';
import { StatusChip, ticketPath } from './tickets';
import { Empty, Kbd } from './ui';

/*
 * `⌘K` and `s` are one component (issue 10): the same panel, opened with a
 * different list in it. It is the dmenu of this window manager, not a dialog —
 * a floating panel at the top of the desk, no backdrop, no dimming, closed by
 * `esc` or by clicking anywhere else.
 *
 * The candidates and the ranking are `palette.ts`; this is the half that knows
 * what is live, and it performs nothing itself: every action goes to the
 * current screen's own verbs (`current.tsx`), so a row here does exactly what
 * the button it stands for does.
 */

/** `⌘K` searches everything; `s` opens on the arrows alone — the current Ticket's, or the Selection's; `move` is the Selection bar's own way in. */
export type PaletteMode = 'anything' | 'status' | 'move';

/** The static half of `go to` — every page that is somewhere to be. */
const PAGES: { label: string; to: string }[] = [
  { label: 'board', to: '/' },
  { label: 'projects', to: '/projects' },
  { label: 'apps', to: '/apps' },
  { label: 'trash', to: '/trash' },
  { label: 'settings', to: '/settings' },
];

export function Palette({ mode, onClose }: { mode: PaletteMode; onClose: () => void }) {
  const current = useCurrentTicket();
  const detail = useTicket(current.key ?? '');
  const ticket = detail.data ?? null;
  /** A Selection outranks the current Ticket here as it does on the keys: its actions replace the Ticket's, never sit beside them. */
  const selected = current.members.length > 0 ? current.members : null;
  const tickets = useTickets();
  const apps = useApps();
  const projects = useProjects();
  const create = useCreate();
  const nav = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  /** The highlighted candidate (DESIGN.md Components), not the Cursor — CONTEXT.md keeps that word for the board. */
  const [highlight, setHighlight] = useState(0);
  /** A nested pick, one level deep: `move to app…` re-opens the panel on the live apps. */
  const [nest, setNest] = useState<'app' | 'project' | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => input.current?.focus(), []);

  // a press anywhere else closes it; there is no backdrop to catch it (DESIGN.md Components)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const filtered = location.pathname === '/' && location.search !== '';
  const all = useMemo(
    (): Candidate[] =>
      nest !== null
        ? selected !== null
          ? selectionPlaceRows(nest, nest === 'app' ? apps.data : projects.data)
          : placeRows(nest, ticket, nest === 'app' ? apps.data : projects.data)
        : mode === 'move'
          ? selectionMoveRows()
          : mode === 'status'
            ? selected !== null
              ? selectionTransitionRows(commonMoves(selected))
              : ticket === null
                ? []
                : transitionRows(ticket.status)
            : [
              ...(tickets.data ?? []).map(
                (t): Candidate => ({
                  id: `ticket-${t.key}`,
                  group: 'tickets',
                  label: t.title,
                  key: t.key,
                  status: t.status,
                  inert: isTerminal(t.status),
                  action: { kind: 'go', to: ticketPath(t) },
                }),
              ),
              ...(selected !== null ? selectionRows(commonMoves(selected)) : ticket ? ticketActions(ticket) : []),
              ...PAGES.map((p): Candidate => ({ id: `go-${p.label}`, group: 'go to', label: p.label, action: { kind: 'go', to: p.to } })),
              ...(apps.data ?? []).map((a): Candidate => ({ id: `go-app-${a.id}`, group: 'go to', label: a.name, note: 'app', action: { kind: 'go', to: slugPath('apps', a) } })),
              ...(projects.data ?? []).map(
                (p): Candidate => ({ id: `go-project-${p.id}`, group: 'go to', label: p.name, note: 'project', action: { kind: 'go', to: slugPath('projects', p) } }),
              ),
              ...([
                { what: 'ticket', label: 'new ticket' },
                { what: 'app', label: 'new app' },
                { what: 'project', label: 'new project' },
              ] as const).map((c): Candidate => ({ id: `create-${c.what}`, group: 'create', label: c.label, action: { kind: 'create', what: c.what } })),
              ...(filtered ? [{ id: 'clear-filters', group: 'board', label: 'clear filters', action: { kind: 'clear-filters' } } satisfies Candidate] : []),
            ],
    [nest, mode, ticket, selected, tickets.data, apps.data, projects.data, filtered],
  );

  const hits = paletteHits(all, query);
  const at = Math.min(highlight, Math.max(hits.length - 1, 0));

  const perform = (action: PaletteAction) => {
    // a nested pick is the one row that leaves the panel open — it is a step, not a choice
    if (action.kind === 'nest') {
      setNest(action.into);
      setQuery('');
      setHighlight(0);
      input.current?.focus();
      return;
    }
    const act = current.actions.current;
    if (action.kind === 'go') nav(action.to);
    else if (action.kind === 'clear-filters') nav('/', { replace: true });
    else if (action.kind === 'create') create(action.what);
    else if (action.kind === 'bulk') current.selectionActions.current?.act(action.action);
    else if (action.kind === 'move') act?.move(action.name);
    else if (action.kind === 'trash') act?.trash();
    else if (action.kind === 'simple') act?.simple(action.simple);
    else if (action.kind === 'blocked-by') act?.blockedBy();
    else if (action.kind === 'copy-branch') act?.copyBranch();
    else if (action.kind === 'add-implementation-link') act?.addImplementationLink();
    else act?.place(action.field, action.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // `esc` closes the topmost thing: a nested pick first, the panel second
      return nest === null ? onClose() : (setNest(null), setQuery(''), setHighlight(0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = hits[at];
      if (chosen) perform(chosen.action);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((c) => {
        const next = Math.min(c, Math.max(hits.length - 1, 0)) + (e.key === 'ArrowDown' ? 1 : -1);
        return (next + hits.length) % Math.max(hits.length, 1);
      });
    }
  };

  // the panel covers the card it is about, so it has to say which one (issue 10 close-out)
  const subject = selected !== null ? countOf(selected.length) : (ticket?.key ?? current.key);
  const placeholder = nest !== null ? `move ${selected !== null ? `${subject} ` : ''}to ${nest}` : mode !== 'anything' ? `move ${subject ?? 'this ticket'}` : 'search tickets, actions, pages';
  /** Why the list is empty, when it is not a query that emptied it: a Selection with no verb in common is an answer, not a miss. */
  const nothing =
    tickets.isPending || (selected === null && current.key !== null && detail.isPending)
      ? 'loading…'
      : mode === 'status' && selected !== null && query.trim() === ''
        ? `no transition fits all ${subject}`
        : 'nothing matches';
  const optionId = (c: Candidate) => `${listId}-${c.id}`;

  return (
    <div className="gf-palette" ref={panel} data-testid="palette">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={hits.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={hits[at] ? optionId(hits[at]) : undefined}
        aria-label="command palette"
        placeholder={placeholder}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />
      {hits.length === 0 ? (
        // "nothing matches" would be a lie while a read is in flight (LESSONS 2026-09-03)
        <Empty>{nothing}</Empty>
      ) : (
        <div id={listId} className="gf-rows gf-palette-hits" role="listbox" aria-label="commands">
          {hits.map((c, i) => (
            <CommandRow
              key={c.id}
              candidate={c}
              id={optionId(c)}
              on={i === at}
              first={hits[i - 1]?.group !== c.group}
              // `trash` and `cancel` are one `⏎` away, so the group that holds them names what it will act on
              group={c.group === 'actions' && subject !== null ? `${c.group} · ${subject}` : c.group}
              onHover={() => setHighlight(i)}
              onPick={() => perform(c.action)}
            />
          ))}
        </div>
      )}
      <span className="gf-tile-keys">
        <Kbd>↑↓</Kbd> move <Kbd>⏎</Kbd> run <Kbd>esc</Kbd> close
      </span>
    </div>
  );
}

/**
 * One row, in the Ticket picker's shape (DESIGN.md Components), under a mono
 * caps label the first time its group appears — the groups are fixed, so the
 * label is what says which one you have arrowed into. Named for what it is
 * rather than `Row`: `ui.tsx` owns that name for the list row, and this is a
 * command.
 */
function CommandRow({
  candidate,
  id,
  on,
  first,
  group,
  onHover,
  onPick,
}: {
  candidate: Candidate;
  id: string;
  on: boolean;
  first: boolean;
  /** What the group label says — `actions · GF-3` where there is a Ticket in hand. */
  group: string;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <>
      {first && (
        <div className="gf-palette-group" role="presentation">
          {group}
        </div>
      )}
      <div
        id={id}
        role="option"
        aria-selected={on}
        className={`gf-row gf-picker-hit${on ? ' is-on' : ''}${candidate.inert ? ' is-inert' : ''}`}
        data-testid={`run-${candidate.id}`}
        onMouseMove={onHover}
        onClick={onPick}
      >
        <span className="gf-pick-title">
          {candidate.key !== undefined && <span className="gf-key">{candidate.key}</span>}
          {candidate.label}
        </span>
        {(candidate.status !== undefined || candidate.note !== undefined) && (
          <span className="gf-row-trail">
            {candidate.status !== undefined ? <StatusChip status={candidate.status} /> : <span className="gf-palette-note">{candidate.note}</span>}
          </span>
        )}
      </div>
    </>
  );
}

/** What can be done to the Ticket in hand — the Ticket view's buttons, by name. */
function ticketActions(ticket: TicketDetail): Candidate[] {
  return [
    ...transitionRows(ticket.status),
    { id: 'act-copy-branch', group: 'actions', label: 'copy branch name', aliases: ['copy git branch'], action: { kind: 'copy-branch' } },
    { id: 'act-add-implementation-link', group: 'actions', label: 'add implementation link', aliases: ['add link', 'add PR', 'add commit', 'pull request'], action: { kind: 'add-implementation-link' } },
    { id: 'act-trash', group: 'actions', label: 'trash', action: { kind: 'trash' } },
    {
      id: 'act-simple',
      group: 'actions',
      label: ticket.simple ? 'unflag simple' : 'flag simple',
      action: { kind: 'simple', simple: !ticket.simple },
    },
    { id: 'act-blocked-by', group: 'actions', label: 'blocked by…', action: { kind: 'blocked-by' } },
    { id: 'act-move-app', group: 'actions', label: 'move to app…', action: { kind: 'nest', into: 'app' } },
    { id: 'act-move-project', group: 'actions', label: 'move to project…', action: { kind: 'nest', into: 'project' } },
  ];
}

/**
 * The second step of `move to app…` / `move to project…`. ADR-0007 as the
 * Ticket view's own selects apply it: a project is only offered under the
 * app the ticket is already in, and an archived target is not somewhere a
 * ticket goes (CONTEXT.md "Archived").
 */
function placeRows(into: 'app' | 'project', ticket: TicketDetail | null, targets: { id: number; name: string; app_id?: number | null }[] | undefined): Candidate[] {
  const field = into === 'app' ? 'app_id' : 'project_id';
  const fits = (t: { app_id?: number | null }) => into === 'app' || ticket === null || ticket.app_id === null || t.app_id === ticket.app_id;
  return [
    { id: `place-none`, group: 'actions', label: `no ${into}`, action: { kind: 'place', field, id: null } },
    ...(targets ?? [])
      .filter(fits)
      .map((t): Candidate => ({ id: `place-${t.id}`, group: 'actions', label: t.name, action: { kind: 'place', field, id: t.id } })),
  ];
}
