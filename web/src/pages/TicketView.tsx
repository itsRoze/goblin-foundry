import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { slugPath, transitionsFrom, type Ticket, type Transition } from '@goblin/shared';
import { formKeys, useKey } from '../keys';
import { useApps, useEvents, useProjects, usePatchTicket, useTicket, useTicketIntent, useTransition } from '../queries';
import { useCrumb } from '../shell';
import { StatusChip, ticketPath, useNames } from '../tickets';
import { Empty, History, Kbd, Kv, Since, Tile, describeTicketEvent, refusalLine, useMinute, useRefusal } from '../ui';
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
function TicketLoaded({ ticket }: { ticket: Ticket }) {
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
  ticket: Ticket;
  onMove: (edge: Transition) => Promise<void>;
  onSimple: (simple: boolean) => Promise<void>;
  onTrash: () => void;
  refusal: string | null;
}) {
  const edges = transitionsFrom(ticket.status);
  return (
    <Tile label="state" testId="state-tile">
      <Kv rows={[['status', <StatusChip status={ticket.status} />]]} />
      <div className="gf-actions">
        {edges
          .filter((e) => e.name !== 'cancel')
          .map((e) => (
            <button key={e.name} className="gf-btn" data-testid={`move-${e.name}`} onClick={() => void onMove(e)}>
              {e.name}
            </button>
          ))}
      </div>
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
