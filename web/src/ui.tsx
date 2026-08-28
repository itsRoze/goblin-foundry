import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Event } from '@goblin/shared';
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

export const Chip = ({ tone, children }: { tone?: 'draft' | 'system' | 'human' | 'mute'; children: ReactNode }) => (
  <span className={`gf-chip${tone ? ` is-${tone}` : ''}`}>{children}</span>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="gf-empty">{children}</p>;

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

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** One history line per event: what happened, not what it means (DESIGN.md §9). */
export function describeEvent(e: Event, appName: (id: unknown) => string): string {
  if (e.kind !== 'updated') return e.kind;
  const keys = Object.keys(e.new);
  const prior = e.prior ?? {};
  if (keys.length === 1 && keys[0] === 'name') return `renamed ${str(prior.name)} → ${str(e.new.name)}`;
  if (keys.length === 1 && keys[0] === 'app_id') return e.new.app_id === null ? `detached from ${appName(prior.app_id)}` : `moved to ${appName(e.new.app_id)}`;
  if (keys.length === 1 && keys[0] === 'project_id') return e.new.project_id === null ? 'left its project' : 'moved to a project';
  return `updated ${keys.join(', ')}`;
}

export function History({ events, appName }: { events: Event[] | undefined; appName: (id: unknown) => string }) {
  if (!events) return <Empty>loading…</Empty>;
  if (events.length === 0) return <Empty>nothing yet</Empty>;
  return (
    <ol className="gf-history" data-testid="history">
      {events.map((e) => (
        <li key={e.id}>
          <span className="gf-history-what">{describeEvent(e, appName)}</span>
          <span className="gf-history-meta">
            {e.actor} · {when(e.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export { when };
