import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TRANSITION_PAST, type Event, type TransitionName } from '@goblin/shared';
import { ProblemError } from './api';
import { useTile } from './desk';
import { formKeys } from './keys';

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="gf-kbd">{children}</kbd>;

/**
 * A key hint in a tile header — `c new` — that is also the control (issue 11):
 * given something to run it is a button, so a finger reaches what the key
 * reaches, in the same words. Without one it is the hint alone, as before. The
 * key is the control, the way `⌘K` in the bar already is.
 */
export function Hint({ k, children, onClick, testId }: { k: ReactNode; children: ReactNode; onClick?: () => void; testId?: string }) {
  if (!onClick)
    return (
      <span className="gf-hint">
        <Kbd>{k}</Kbd> {children}
      </span>
    );
  return (
    <button type="button" className="gf-hint" data-testid={testId} onClick={onClick}>
      <Kbd>{k}</Kbd> {children}
    </button>
  );
}

/**
 * A press anywhere outside the element closes it — a popover, a menu. The
 * listener watches the whole slot (the button and its panel) rather than the
 * panel alone: watching the panel would close on the way down and let the
 * button's own click reopen it, so pressing an open button a second time would
 * never shut it. A tap is a press too; the browser sends the mouse event after it.
 */
export function useCloseOnOutside(slot: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!slot.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [slot, open, onClose]);
}

/**
 * A tile, and its place in the keyboard: it registers itself with the desk,
 * which numbers the tiles in reading order and says which one has the focus
 * (CONTEXT.md "Focused tile"). The label is the address — unique on a page,
 * and what `useCursor` and `d` name a tile by — so it is also what the header
 * shows. Focus follows a click, as it does in a tiling window manager.
 */
export function Tile({
  label,
  subtitle,
  keys,
  navigable,
  span,
  children,
  testId,
}: {
  label: string;
  subtitle?: ReactNode;
  keys?: ReactNode;
  /** Its body is rows or cards, so the focused tile offers `j k ⏎` (a history is not navigable). */
  navigable?: boolean;
  /** The whole width of the desk. For a page that is one tile — the kanban needs every column it has (DESIGN.md Layout). */
  span?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const tile = useTile(label);
  return (
    <section
      ref={tile.ref}
      className={`gf-tile${tile.focused ? ' is-focus' : ''}${span ? ' is-span' : ''}`}
      // the focus is a border to the eye and nothing at all to a screen reader without this
      aria-current={tile.focused ? true : undefined}
      aria-label={label}
      data-testid={testId}
      onMouseDown={tile.focus}
    >
      <div className="gf-tile-head">
        <span>{label}</span>
        {subtitle && <span className="gf-tile-sub">{subtitle}</span>}
        <span className="gf-tile-keys">
          {keys}
          {navigable && tile.focused && (
            <span className="gf-tile-move">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
              <Kbd>⏎</Kbd>
            </span>
          )}
          {tile.n !== null && <Kbd>⌘{tile.n}</Kbd>}
        </span>
      </div>
      <div className="gf-tile-body">{children}</div>
    </section>
  );
}

/** One accent, one meaning (DESIGN.md Colors); no tone is the mute default. */
export type Tone = 'draft' | 'system' | 'review' | 'mute';

export const Chip = ({ tone, struck, children }: { tone?: Tone; struck?: boolean; children: ReactNode }) => (
  <span className={`gf-chip${tone ? ` is-${tone}` : ''}${struck ? ' is-struck' : ''}`}>{children}</span>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="gf-empty">{children}</p>;

/** Opens a tile's inline create form. `n` is retired; `⌘K` reaches the same form by name (issue 10). */
export const Plus = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="gf-plus" aria-label={label} onClick={onClick}>
    +
  </button>
);

/** `[title] [meta] [trailing]` — the list row; a link when `to` is given, and the Cursor's mark when it is here. */
export function Row({ to, title, meta, trailing, cursor, testId }: { to?: string; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; cursor?: boolean; testId?: string }) {
  const body = (
    <>
      <span className="gf-row-title">{title}</span>
      {meta && <span className="gf-row-meta">{meta}</span>}
      {trailing && <span className="gf-row-trail">{trailing}</span>}
    </>
  );
  const className = `gf-row${cursor ? ' is-cursor' : ''}`;
  return to ? (
    <Link className={className} to={to} aria-current={cursor ? true : undefined} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

export const Kv = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="gf-kv">
    {rows.map(([k, v]) => (
      <div key={k} className="gf-kv-row">
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

export interface Field {
  name: string;
  label: string;
  kind?: 'text' | 'textarea' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
}

/**
 * The inline create/edit form inside a tile: `⌘⏎` saves, `esc` cancels.
 * Values are strings; the caller turns them into a body and reports a
 * `ProblemError` back as the inline message.
 */
export function InlineForm({
  fields,
  initial = {},
  submitLabel,
  onSubmit,
  onCancel,
  testId,
}: {
  fields: Field[];
  initial?: Record<string, string>;
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onCancel: () => void;
  testId?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? ''])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof ProblemError ? e.sentence : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="gf-form"
      data-testid={testId}
      onKeyDown={formKeys(save, onCancel)}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields.map((f, i) => {
        const id = `f-${f.name}`;
        const common = {
          id,
          name: f.name,
          value: values[f.name] ?? '',
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues({ ...values, [f.name]: e.target.value }),
          ref: i === 0 ? (first as never) : undefined,
        };
        return (
          <label key={f.name} className="gf-field" htmlFor={id}>
            <span>{f.label}</span>
            {f.kind === 'textarea' ? (
              <textarea {...common} rows={3} placeholder={f.placeholder} />
            ) : f.kind === 'select' ? (
              <select {...common}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input {...common} type="text" placeholder={f.placeholder} autoComplete="off" />
            )}
          </label>
        );
      })}
      {error && (
        <p className="gf-refusal" role="alert">
          {error}
        </p>
      )}
      <div className="gf-form-actions">
        <button type="submit" className="gf-btn is-primary" disabled={busy}>
          {submitLabel} <Kbd>⌘⏎</Kbd>
        </button>
        <button type="button" className="gf-btn" onClick={onCancel}>
          cancel <Kbd>esc</Kbd>
        </button>
      </div>
    </form>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

const MINUTE = 60_000;

/** `3m`, `2h`, `4d`, then a short date — the ISO stamp lives in the tooltip. */
export function since(iso: string, at: number = Date.now()): string {
  const ms = at - new Date(iso).getTime();
  if (ms < MINUTE) return 'now';
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < 24 * 60 * MINUTE) return `${Math.floor(ms / (60 * MINUTE))}h`;
  if (ms < 7 * 24 * 60 * MINUTE) return `${Math.floor(ms / (24 * 60 * MINUTE))}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Ticks once a minute so relative times stay honest without a poll. */
export function useMinute(): number {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAt(Date.now()), MINUTE);
    return () => clearInterval(t);
  }, []);
  return at;
}

export const Since = ({ iso, at }: { iso: string; at: number }) => (
  <span title={iso} className="gf-since">
    {since(iso, at)}
  </span>
);

const REFUSAL_MS = 4_000;

/** What a refused write says: a `409`'s hint, a `422`'s issues, or whatever else went wrong. */
export const refusalLine = (e: unknown) => (e instanceof ProblemError ? e.sentence : String(e));

/**
 * A refusal message is one sentence that clears itself: on the next click, or
 * after four seconds (DESIGN.md Components). Every surface that refuses — the board's
 * drop, the state tile's buttons — holds one of these, so the sentence never
 * outlives the situation that produced it.
 */
export function useRefusal<T>() {
  const [refusal, setRefusal] = useState<T | null>(null);
  useEffect(() => {
    if (refusal === null) return;
    const clear = () => setRefusal(null);
    const timer = setTimeout(clear, REFUSAL_MS);
    window.addEventListener('click', clear);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', clear);
    };
  }, [refusal]);
  return { refusal, setRefusal };
}

/**
 * The one question the tracker asks before doing what you said. It lives where
 * a refusal would, because it is the same kind of sentence — this one just has
 * a way through it (ADR-0009: `start` means "proceeding despite the blocker").
 */
export function Confirm({ text, verb, onConfirm, onCancel, testId }: { text: string; verb: string; onConfirm: () => void; onCancel: () => void; testId?: string }) {
  return (
    <p className="gf-confirm" role="alert" data-testid={testId}>
      <span>{text}</span>
      <button type="button" className="gf-btn" data-testid={`${testId ?? 'confirm'}-yes`} onClick={onConfirm}>
        {verb} anyway
      </button>
      <button type="button" className="gf-btn" onClick={onCancel}>
        cancel
      </button>
    </p>
  );
}

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** The name of a thing an event points at; `#3` once it is gone. */
export type Namer = (id: unknown) => string;

/** One history line per event: what happened, not what it means (DESIGN.md Voice). */
export function describeEvent(e: Event, appName: Namer): string {
  if (e.kind !== 'updated') return e.kind;
  const keys = Object.keys(e.new);
  const prior = e.prior ?? {};
  if (keys.length === 1 && keys[0] === 'name') return `renamed ${str(prior.name)} → ${str(e.new.name)}`;
  if (keys.length === 1 && keys[0] === 'app_id') return e.new.app_id === null ? `detached from ${appName(prior.app_id)}` : `moved to ${appName(e.new.app_id)}`;
  if (keys.length === 1 && keys[0] === 'project_id') return e.new.project_id === null ? 'left its project' : 'moved to a project';
  // the bodies are in the event (recovery is the edit session, ADR-0008); the history says only that a sitting happened
  if (keys.length === 1 && keys[0] === 'design') return 'design edited';
  if (keys.length === 1 && keys[0] === 'description') return 'description edited';
  return `updated ${keys.join(', ')}`;
}

const past = (name: unknown) => (typeof name === 'string' && name in TRANSITION_PAST ? TRANSITION_PAST[name as TransitionName] : String(name));

/**
 * A ticket's history. A description edit is one quiet line — the body is in
 * the event (S2 wants prior bodies), never on screen here.
 */
export function describeTicketEvent(e: Event, name: { app: Namer; project: Namer }): string {
  // `approved · planning → ready`: the decision first, the state pair after it
  if (e.kind === 'transitioned') return `${past(e.new.transition)} · ${str(e.prior?.status)} → ${str(e.new.status)}`;
  // one edge, written on both its ends: each side's history says which end this ticket is (ADR-0009)
  if (e.kind === 'dependency_added' || e.kind === 'dependency_removed') {
    const undone = e.kind === 'dependency_removed' ? 'no longer ' : '';
    return 'blocker' in e.new ? `${undone}blocked by ${str(e.new.blocker)}` : `${undone}blocking ${str(e.new.blocked)}`;
  }
  if (e.kind === 'implementation_link_added') return `linked implementation · ${str(e.new.url)}`;
  if (e.kind === 'implementation_link_removed') return `removed implementation link · ${str(e.prior?.url)}`;
  if (e.kind !== 'updated') return e.kind;
  const prior = e.prior ?? {};
  const parts: string[] = [];
  if ('title' in e.new) parts.push(`renamed ${str(prior.title)} → ${str(e.new.title)}`);
  if ('description' in e.new) parts.push('description edited');
  if ('design' in e.new) parts.push('design edited');
  if ('simple' in e.new) parts.push(e.new.simple ? 'flagged simple' : 'no longer simple');
  const toProject = 'project_id' in e.new && e.new.project_id !== null;
  if ('project_id' in e.new) parts.push(toProject ? `moved to project ${name.project(e.new.project_id)}` : 'removed from project');
  if ('app_id' in e.new && !toProject) parts.push(e.new.app_id === null ? 'removed from app' : `moved to app ${name.app(e.new.app_id)}`);
  return parts.length ? parts.join(' · ') : `updated ${Object.keys(e.new).join(', ')}`;
}

/** `quietActor` names the actor only when it is not you — an agent edit is worth seeing. */
export function History({ events, describe, quietActor }: { events: Event[] | undefined; describe: (e: Event) => string; quietActor?: boolean }) {
  if (!events) return <Empty>loading…</Empty>;
  if (events.length === 0) return <Empty>nothing yet</Empty>;
  return (
    <ol className="gf-history" data-testid="history">
      {events.map((e) => (
        <li key={e.id}>
          <span className="gf-history-what">{describe(e)}</span>
          <span className="gf-history-meta">
            {quietActor && e.actor === 'human' ? '' : `${e.actor} · `}
            {when(e.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export { when };
