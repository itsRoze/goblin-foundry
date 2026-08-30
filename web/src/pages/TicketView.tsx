import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  asksBeforeBlocked,
  blockedWarning,
  isTerminal,
  slugPath,
  transitionsFrom,
  type DependencyRef,
  type TicketDetail,
  type Transition,
} from '@goblin/shared';
import { formKeys, useKey } from '../keys';
import { useApps, useDependencyEdges, useEvents, useProjects, usePatchTicket, useTicket, useTicketIntent, useTickets, useTransition } from '../queries';
import { useCrumb } from '../shell';
import { StatusChip, ticketPath, useNames } from '../tickets';
import { Confirm, Empty, History, Kbd, Kv, Since, Tile, describeTicketEvent, refusalLine, useMinute, useRefusal } from '../ui';
import { NotFound } from './Entity';

export function TicketView() {
  const { key = '' } = useParams();
  const ticket = useTicket(key);
  if (ticket.isError) return <NotFound what="ticket" />;
  if (!ticket.data) return <Empty>loading…</Empty>;
  return <TicketLoaded ticket={ticket.data} />;
}

/**
 * One ticket: what it says, where it lives, what state it is in, what has
 * happened to it. The state tile's buttons are the transition table read from
 * the other end — the same arrows the board's drag offers (ADR-0003).
 */
function TicketLoaded({ ticket }: { ticket: TicketDetail }) {
  const { key = '' } = useParams();
  const apps = useApps();
  const projects = useProjects();
  const app = apps.data?.find((a) => a.id === ticket.app_id);
  const project = projects.data?.find((p) => p.id === ticket.project_id);
  useCrumb([app?.name, project?.name, ticket.key].filter(Boolean).join(' / '));
  const events = useEvents('ticket', ticket.id);
  const names = useNames();
  const at = useMinute();
  const patch = usePatchTicket(ticket.key);
  const intent = useTicketIntent(ticket.key);
  const move = useTransition();
  const [editing, setEditing] = useState(false);
  // two refusal lines, because a refused transition belongs under the state tile and a refused edit under the fields it names
  const [refusal, setRefusal] = useState<string | null>(null);
  const state = useRefusal<string>();
  const nav = useNavigate();
  const { setRefusal: setStateRefusal } = state;
  /** Every write the state tile makes reports its refusal in the tile's one line. */
  const inState = useCallback(
    async (write: () => Promise<unknown>) => {
      setStateRefusal(null);
      try {
        await write();
      } catch (e) {
        setStateRefusal(refusalLine(e));
      }
    },
    [setStateRefusal],
  );
  useKey('e', useCallback(() => setEditing(true), []));

  const trash = useCallback(
    () =>
      inState(async () => {
        await intent.mutateAsync('trash');
        nav('/');
      }),
    [inState, intent, nav],
  );
  useKey('Backspace', trash, { meta: true });

  // the number is the identity; a bare number or a stale prefix lands on the canonical key (ADR-0002)
  if (ticket.key !== key) return <Navigate to={ticketPath(ticket)} replace />;

  const save = async (body: Parameters<typeof patch.mutateAsync>[0]) => {
    setRefusal(null);
    try {
      await patch.mutateAsync(body);
    } catch (e) {
      setRefusal(refusalLine(e));
    }
  };

  return (
    <>
      <h1 className="gf-title" data-testid="page-title">
        {app && (
          <>
            <Link to={slugPath('apps', app)} className="gf-title-parent">
              {app.name}
            </Link>{' '}
            /{' '}
          </>
        )}
        {project && (
          <>
            <Link to={slugPath('projects', project)} className="gf-title-parent">
              {project.name}
            </Link>{' '}
            /{' '}
          </>
        )}
        <span className="gf-key">{ticket.key}</span> {ticket.title}
      </h1>

      <Tile
        label="about"
        keys={
          <>
            <Kbd>e</Kbd> edit
          </>
        }
        focus
        testId="about-tile"
      >
        <InlineTitle value={ticket.title} onSave={(title) => save({ title })} />
        <Description value={ticket.description} editing={editing} onCancel={() => setEditing(false)} onSave={async (description) => {
          await save({ description });
          setEditing(false);
        }} />
        <Kv
          rows={[
            [
              'app',
              <select
                aria-label="app"
                data-testid="app-select"
                value={ticket.app_id === null ? '' : String(ticket.app_id)}
                onChange={(e) => void save({ app_id: e.target.value ? Number(e.target.value) : null, project_id: null })}
              >
                <option value="">no app</option>
                {(apps.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>,
            ],
            [
              'project',
              <select
                aria-label="project"
                data-testid="project-select"
                value={ticket.project_id === null ? '' : String(ticket.project_id)}
                onChange={(e) => void save({ project_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">no project</option>
                {(projects.data ?? [])
                  .filter((p) => ticket.app_id === null || p.app_id === ticket.app_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>,
            ],
            ['created', <Since iso={ticket.created_at} at={at} />],
            ['updated', <Since iso={ticket.updated_at} at={at} />],
          ]}
        />
        {refusal && (
          <p className="gf-refusal" role="alert">
            {refusal}
          </p>
        )}
      </Tile>

      <DependenciesTile ticket={ticket} />

      <StateTile
        ticket={ticket}
        onMove={(edge) => inState(() => move.mutateAsync({ key: ticket.key, name: edge.name, to: edge.to }))}
        onSimple={(simple) => inState(() => patch.mutateAsync({ simple }))}
        onTrash={() => void trash()}
        refusal={state.refusal}
      />

      <Tile label="history" subtitle={events.data ? String(events.data.length) : undefined}>
        <History events={events.data} describe={(e) => describeTicketEvent(e, names)} quietActor />
      </Tile>
    </>
  );
}

/**
 * The ticket's edges, both ways round and both editable. An edge is one fact
 * with two ends, so "blocked by GF-3" and "blocks GF-9" are the same
 * declaration seen from either side; the endpoint always addresses the blocked
 * ticket (ADR-0004), which for the `blocks` side is the *other* one. Every
 * declared edge is shown, satisfied ones struck rather than dropped: the edge
 * is still a true fact, and it bites again if the blocker reopens (ADR-0009).
 */
function DependenciesTile({ ticket }: { ticket: TicketDetail }) {
  const { add, remove } = useDependencyEdges();
  // one picker at a time: opening the other side closes this one, so the tile never asks two questions at once
  const [picking, setPicking] = useState<Direction | null>(null);
  // a refusal belongs beside the control that earned it (DESIGN.md §6), so it is filed by direction
  const [refusal, setRefusal] = useState<{ direction: Direction; text: string } | null>(null);
  const { depends_on, blocks } = ticket.dependencies;
  const stillOpen = new Set(ticket.blocked_by);

  const write = async (direction: Direction, run: () => Promise<unknown>) => {
    setRefusal(null);
    try {
      await run();
      return true;
    } catch (e) {
      setRefusal({ direction, text: refusalLine(e) });
      return false;
    }
  };

  /** Which end of the new edge this ticket is; the picker supplies the other. */
  const edgeWith = (direction: Direction, other: string) =>
    direction === 'depends_on' ? { blocker: other, blocked: ticket.key } : { blocker: ticket.key, blocked: other };

  const section = (direction: Direction, deps: DependencyRef[], empty: string) => (
    <DependencySection
      direction={direction}
      deps={deps}
      empty={empty}
      // a blocker is inert once it is out of the way; a ticket this one blocks is inert once it has nowhere left to go
      inert={(d) => (direction === 'depends_on' ? !stillOpen.has(d.key) : isTerminal(d.status))}
      // the DELETE addresses the blocked end, and a trashed ticket is not addressable — restore it to undo that edge
      removable={(d) => direction === 'depends_on' || !d.trashed}
      picking={picking === direction}
      onOpen={() => {
        setRefusal(null);
        setPicking(picking === direction ? null : direction);
      }}
      onClose={() => setPicking(null)}
      // both sides, so the picker never offers the one-hop cycle the server would only refuse after a round trip
      taken={[ticket.key, ...depends_on.map((d) => d.key), ...blocks.map((d) => d.key)]}
      refusal={refusal?.direction === direction ? refusal.text : null}
      onPick={async (other) => {
        if (await write(direction, () => add.mutateAsync(edgeWith(direction, other)))) setPicking(null);
      }}
      onRemove={(other) => void write(direction, () => remove.mutateAsync(edgeWith(direction, other)))}
    />
  );

  return (
    <Tile label="dependencies" testId="dependencies-tile">
      {section('depends_on', depends_on, 'nothing in the way')}
      {section('blocks', blocks, 'nothing waiting on this')}
    </Tile>
  );
}

/** The two ends of an edge, as the tile labels them. */
type Direction = 'depends_on' | 'blocks';
const DIRECTION_LABEL: Record<Direction, string> = { depends_on: 'blocked by', blocks: 'blocks' };

/**
 * One direction: a labelled rule, the edges as rows, and the picker that adds
 * to *this* side — opened underneath its own heading, so there is never a
 * question which way round the new edge goes.
 */
function DependencySection({
  direction,
  deps,
  empty,
  inert,
  removable,
  picking,
  taken,
  refusal,
  onOpen,
  onClose,
  onPick,
  onRemove,
}: {
  direction: Direction;
  deps: DependencyRef[];
  empty: string;
  inert: (d: DependencyRef) => boolean;
  /** Whether this row's edge can be undone from here at all. */
  removable: (d: DependencyRef) => boolean;
  picking: boolean;
  /** Why the last write on this side was refused — shown here, not at the foot of the tile. */
  refusal: string | null;
  /** Keys the picker must not offer: this ticket, and whatever either side already names. */
  taken: string[];
  onOpen: () => void;
  onClose: () => void;
  onPick: (key: string) => Promise<void>;
  onRemove: (key: string) => void;
}) {
  const label = DIRECTION_LABEL[direction];
  return (
    <section className="gf-dep-section" data-testid={`deps-${direction}`}>
      {/* the control sits beside its label, never across the tile from it: this tile is full-width on a wide desk */}
      <h3 className="gf-dep-head">
        <span>{label}</span>
        <button type="button" className="gf-dep-add" aria-expanded={picking} data-testid={`add-${direction}`} onClick={onOpen}>
          {picking ? 'close' : '+ add'}
        </button>
        <span className="gf-dep-rule" />
      </h3>
      {picking && <TicketPicker label={label} taken={taken} onPick={onPick} onCancel={onClose} testId={`picker-${direction}`} />}
      {refusal && (
        <p className="gf-refusal" role="alert" data-testid={`refusal-${direction}`}>
          {refusal}
        </p>
      )}
      {deps.length === 0 && !picking ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="gf-rows">
          {deps.map((d) => (
            <DependencyRow key={d.key} dep={d} inert={inert(d)} removable={removable(d)} onRemove={() => onRemove(d.key)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One edge, in the same row shape the App and Project views use for tickets,
 * so what you picked looks like what you got. A trashed end is *not* struck:
 * it is suspended rather than settled, and says so, because restoring it puts
 * the block straight back (ADR-0009).
 */
function DependencyRow({ dep, inert, removable, onRemove }: { dep: DependencyRef; inert: boolean; removable: boolean; onRemove: () => void }) {
  return (
    <div className={`gf-row gf-dep-row${inert && !dep.trashed ? ' is-inert' : ''}`} data-testid={`dep-${dep.key}`}>
      <Link className="gf-row-title" to={ticketPath(dep)}>
        <span className="gf-key">{dep.key}</span>
        {dep.title}
      </Link>
      <span className="gf-row-trail">
        {dep.trashed && <span className="gf-dep-note">in the trash</span>}
        <StatusChip status={dep.status} />
        {removable && (
          <button type="button" className="gf-dep-drop" aria-label={`remove ${dep.key}`} title={`remove ${dep.key}`} onClick={onRemove}>
            ×
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Search by key or title, arrow keys to move, `⏎` to declare. The candidates
 * wear the same row shape as the edges above them and the highlighted one
 * takes the selected-row treatment (DESIGN.md §6), which is what says "these
 * are choices" rather than "this is a list of things".
 *
 * It offers what could sensibly be declared: never this ticket, never an edge
 * this side already names, never anything trashed (the list read has none) —
 * and `done`/`cancelled` tickets last, since declaring one is legal but rarely
 * what you meant.
 */
function TicketPicker({
  label,
  taken,
  onPick,
  onCancel,
  testId,
}: {
  label: string;
  taken: string[];
  onPick: (key: string) => Promise<void>;
  onCancel: () => void;
  testId: string;
}) {
  const all = useTickets();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const listId = useId();
  const optionId = (key: string) => `${listId}-${key}`;

  const spoken = new Set(taken);
  const needle = query.trim().toLowerCase();
  const hits = (all.data ?? [])
    .filter((t) => !spoken.has(t.key))
    .filter((t) => needle === '' || t.key.toLowerCase().includes(needle) || t.title.toLowerCase().includes(needle))
    .sort((a, b) => Number(isTerminal(a.status)) - Number(isTerminal(b.status)))
    .slice(0, 6);
  const at = Math.min(cursor, Math.max(hits.length - 1, 0));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return e.preventDefault(), onCancel();
    if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = hits[at];
      if (chosen) void onPick(chosen.key);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => {
        const next = Math.min(c, Math.max(hits.length - 1, 0)) + (e.key === 'ArrowDown' ? 1 : -1);
        return (next + hits.length) % Math.max(hits.length, 1);
      });
    }
  };

  return (
    <div className="gf-picker" data-testid={testId}>
      {/* focus stays in the input and `aria-activedescendant` moves instead, which is what lets `↑↓` be announced at all */}
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-activedescendant={hits[at] ? optionId(hits[at].key) : undefined}
        aria-label={`${label} — search tickets`}
        placeholder="search by key or title"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        onKeyDown={onKeyDown}
      />
      {hits.length === 0 ? (
        <Empty>no ticket matches</Empty>
      ) : (
        <div id={listId} className="gf-rows gf-picker-hits" role="listbox" aria-label={`${label} — candidates`}>
          {/* options are divs, not buttons: a listbox child must not be tab-focusable when the input holds focus */}
          {hits.map((t, i) => (
            <div
              key={t.key}
              id={optionId(t.key)}
              role="option"
              aria-selected={i === at}
              className={`gf-row gf-picker-hit${i === at ? ' is-on' : ''}${isTerminal(t.status) ? ' is-inert' : ''}`}
              data-testid={`pick-${t.key}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => void onPick(t.key)}
            >
              <span className="gf-row-title gf-pick-title">
                <span className="gf-key">{t.key}</span>
                {t.title}
              </span>
              <span className="gf-row-trail">
                <StatusChip status={t.status} />
              </span>
            </div>
          ))}
        </div>
      )}
      {/* `esc` also closes, but the heading already carries a `close` — one way out on screen is enough */}
      <span className="gf-tile-keys">
        <Kbd>↑↓</Kbd> move <Kbd>⏎</Kbd> add
      </span>
    </div>
  );
}

/**
 * The lifecycle by button rather than by drag. `approve` is offered even when
 * its guard will refuse — the refusal is how you learn what is missing, and
 * hiding it would leave a ready-looking ticket with no way forward and no
 * explanation. `cancel` sits with `trash` because both are ways of stopping.
 */
function StateTile({
  ticket,
  onMove,
  onSimple,
  onTrash,
  refusal,
}: {
  ticket: TicketDetail;
  onMove: (edge: Transition) => Promise<void>;
  onSimple: (simple: boolean) => Promise<void>;
  onTrash: () => void;
  refusal: string | null;
}) {
  const edges = transitionsFrom(ticket.status);
  const [confirming, setConfirming] = useState(false);
  const press = (edge: Transition) => {
    if (asksBeforeBlocked(edge.name, ticket)) return setConfirming(true);
    void onMove(edge);
  };
  return (
    <Tile label="state" testId="state-tile">
      <Kv rows={[['status', <StatusChip status={ticket.status} />]]} />
      <div className="gf-actions">
        {edges
          .filter((e) => e.name !== 'cancel')
          .map((e) => (
            <button key={e.name} className="gf-btn" data-testid={`move-${e.name}`} onClick={() => press(e)}>
              {e.name}
            </button>
          ))}
      </div>
      {confirming && (
        <Confirm
          text={blockedWarning(ticket.blocked_by)}
          verb="start"
          testId="confirm-start"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            const start = edges.find((e) => e.name === 'start');
            if (start) void onMove(start);
          }}
        />
      )}
      <div className="gf-actions is-separated">
        {edges
          .filter((e) => e.name === 'cancel')
          .map((e) => (
            <button key={e.name} className="gf-btn is-danger" data-testid="move-cancel" onClick={() => void onMove(e)}>
              cancel
            </button>
          ))}
        <button className="gf-btn is-danger" onClick={onTrash}>
          trash <Kbd>⌘⌫</Kbd>
        </button>
      </div>
      <label className="gf-toggle">
        <input type="checkbox" data-testid="simple-toggle" checked={ticket.simple} onChange={(e) => void onSimple(e.target.checked)} /> simple — no ticket design needed
      </label>
      {refusal && (
        <p className="gf-refusal" role="alert" data-testid="state-refusal">
          {refusal}
        </p>
      )}
    </Tile>
  );
}

/** The title edits in place: click it, `⌘⏎` saves, `esc` puts it back. */
function InlineTitle({ value, onSave }: { value: string; onSave: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (!editing)
    return (
      <button
        className="gf-inline-title"
        data-testid="ticket-title"
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );

  return (
    <input
      ref={input}
      className="gf-inline-title-input"
      aria-label="title"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={formKeys(
        () => {
          void onSave(text.trim()).then(() => setEditing(false));
        },
        () => setEditing(false),
      )}
    />
  );
}

/**
 * Plain text for now — issue 07 swaps the widget in without changing the keys.
 * The editor is a separate component so its draft is seeded once, when it
 * mounts: a refetch (focus, or a write elsewhere) must not overwrite typing.
 */
function Description({ value, editing, onSave, onCancel }: { value: string; editing: boolean; onSave: (description: string) => Promise<void>; onCancel: () => void }) {
  if (editing) return <DescriptionEditor initial={value} onSave={onSave} onCancel={onCancel} />;
  return value ? (
    <p className="gf-prose" data-testid="description">
      {value}
    </p>
  ) : (
    <Empty>no description — press e</Empty>
  );
}

function DescriptionEditor({ initial, onSave, onCancel }: { initial: string; onSave: (description: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);

  return (
    <label className="gf-field is-stacked">
      <span>description</span>
      <textarea ref={area} aria-label="description" rows={6} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={formKeys(() => void onSave(text), onCancel)} />
      <span className="gf-tile-keys">
        <Kbd>⌘⏎</Kbd> save <Kbd>esc</Kbd> cancel
      </span>
    </label>
  );
}
