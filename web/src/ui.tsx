import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TRANSITION_PAST, type Event, type TransitionName } from '@goblin/shared';
import { ProblemError } from './api';
import { formKeys } from './keys';

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="gf-kbd">{children}</kbd>;

export function Tile({
  label,
  subtitle,
  keys,
  focus,
  children,
  testId,
}: {
  label: string;
  subtitle?: ReactNode;
  keys?: ReactNode;
  focus?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={`gf-tile${focus ? ' is-focus' : ''}`} aria-label={label} data-testid={testId}>
      <div className="gf-tile-head">
        <span>{label}</span>
        {subtitle && <span className="gf-tile-sub">{subtitle}</span>}
        {keys && <span className="gf-tile-keys">{keys}</span>}
      </div>
      <div className="gf-tile-body">{children}</div>
    </section>
  );
}

/** One accent, one meaning (DESIGN.md §3); no tone is the mute default. */
export type Tone = 'draft' | 'system' | 'review' | 'mute';

export const Chip = ({ tone, struck, children }: { tone?: Tone; struck?: boolean; children: ReactNode }) => (
  <span className={`gf-chip${tone ? ` is-${tone}` : ''}${struck ? ' is-struck' : ''}`}>{children}</span>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="gf-empty">{children}</p>;

/** Opens a tile's inline create form. `n` is retired; `⌘K` takes this over in issue 10. */
export const Plus = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="gf-plus" aria-label={label} onClick={onClick}>
    +
  </button>
);

/** `[title] [meta] [trailing]` — the list row; a link when `to` is given. */
export function Row({ to, title, meta, trailing, testId }: { to?: string; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; testId?: string }) {
  const body = (
    <>
      <span className="gf-row-title">{title}</span>
      {meta && <span className="gf-row-meta">{meta}</span>}
      {trailing && <span className="gf-row-trail">{trailing}</span>}
    </>
  );
  return to ? (
    <Link className="gf-row" to={to} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="gf-row" data-testid={testId}>
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
      setError(e instanceof ProblemError ? e.line : e instanceof Error ? e.message : String(e));
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
export const refusalLine = (e: unknown) => (e instanceof ProblemError ? e.line : String(e));

/**
 * A refusal message is one sentence that clears itself: on the next click, or
 * after four seconds (DESIGN.md §6). Every surface that refuses — the board's
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

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** The name of a thing an event points at; `#3` once it is gone. */
export type Namer = (id: unknown) => string;

/** One history line per event: what happened, not what it means (DESIGN.md §9). */
export function describeEvent(e: Event, appName: Namer): string {
  if (e.kind !== 'updated') return e.kind;
  const keys = Object.keys(e.new);
  const prior = e.prior ?? {};
  if (keys.length === 1 && keys[0] === 'name') return `renamed ${str(prior.name)} → ${str(e.new.name)}`;
  if (keys.length === 1 && keys[0] === 'app_id') return e.new.app_id === null ? `detached from ${appName(prior.app_id)}` : `moved to ${appName(e.new.app_id)}`;
  if (keys.length === 1 && keys[0] === 'project_id') return e.new.project_id === null ? 'left its project' : 'moved to a project';
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
