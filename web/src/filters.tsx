import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BOARD_STATUSES,
  TICKET_STATUSES,
  canonicalLabels,
  canonicalStatuses,
  serialiseTicketFilter,
  type FilterParam,
  type TicketFilter,
  type TicketStatus,
} from '@goblin/shared';
import { useKey } from './keys';
import { useApps, useLabelNames, useProjects } from './queries';
import { projectFitsApp, useNames } from './tickets';
import { Hint, Kbd, useCloseOnOutside } from './ui';

/**
 * The board's Filter bar (issue 06): the strip between the tile header and the
 * columns. Four chips, the text input, and `×`. Every change writes the
 * address — which is where the filter lives (GLOSSARY.md "Filter") — so this
 * component holds no state of its own but the popover that is open and the
 * text that has not settled yet.
 */

/** Which chip's popover is open; one at a time, so the bar never asks two questions at once. */
type Which = 'app' | 'project' | 'status' | 'label';

/** How long the text input waits for quiet before it writes the address; the chips write at once. */
const SETTLE_MS = 200;

/** A parameter the API refused, as the address wrote it: the chip shows it so the refusal has something to point at. */
export type BadValues = Partial<Record<FilterParam, string>>;

export function FilterBar({
  filter,
  bad,
  onChange,
  refusal,
  findRef,
}: {
  filter: TicketFilter;
  bad: BadValues;
  onChange: (next: TicketFilter) => void;
  refusal: string | null;
  /** Handed back to the board so its `f find` hint can be the control as well as the key (issue 11). */
  findRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [open, setOpen] = useState<Which | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const text = useRef<HTMLInputElement>(null);
  const find = useCallback(() => text.current?.focus(), []);
  useKey('f', find);
  useEffect(() => {
    if (!findRef) return;
    findRef.current = find;
    return () => {
      findRef.current = null;
    };
  }, [findRef, find]);

  return (
    <div className="gf-filters" data-testid="filter-bar">
      <EntityChip which="app" filter={filter} bad={bad.app_id} onChange={onChange} open={open === 'app'} onOpen={setOpen} onClose={close} />
      <EntityChip which="project" filter={filter} bad={bad.project_id} onChange={onChange} open={open === 'project'} onOpen={setOpen} onClose={close} />
      <StatusChipButton filter={filter} bad={bad.status} onChange={onChange} open={open === 'status'} onOpen={setOpen} onClose={close} />
      <LabelChipButton filter={filter} bad={bad.label} onChange={onChange} open={open === 'label'} onOpen={setOpen} onClose={close} />
      <TextFilter q={filter.q} onChange={(q) => onChange({ ...filter, q })} inputRef={text} />
      <button
        type="button"
        className="gf-filter-clear"
        aria-label="clear filters"
        // nothing to clear is a missing affordance, not a state: the control stays in place and stops answering
        disabled={serialiseTicketFilter(filter) === ''}
        onClick={() => onChange({})}
      >
        ×
      </button>
      {refusal && (
        <p className="gf-refusal gf-filter-refusal" role="alert" data-testid="filter-refusal">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * The text half. It writes after 200 ms of quiet so a bookmark is not one URL
 * per keystroke; the address stays the truth, and a `q` that changed elsewhere
 * (the `×`, a fresh load) replaces what is in the box.
 */
function TextFilter({ q, onChange, inputRef }: { q: string | undefined; onChange: (q: string) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const settled = q ?? '';
  const [typed, setTyped] = useState(settled);
  useEffect(() => setTyped(settled), [settled]);
  useEffect(() => {
    if (typed === settled) return;
    const timer = setTimeout(() => onChange(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed, settled, onChange]);

  return (
    <input
      ref={inputRef}
      className={`gf-filter-text${typed === '' ? '' : ' is-set'}`}
      type="text"
      aria-label="filter by text"
      placeholder="title or description"
      autoComplete="off"
      value={typed}
      onChange={(e) => setTyped(e.target.value)}
      // `esc` lets go without clearing: what you typed is in the address, and the address is not undone by looking away
      onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), e.currentTarget.blur())}
    />
  );
}

/**
 * A chip reads its bare label when unset, `app: subway reader` when set
 * (DESIGN.md Components). No `aria-label`: an overriding one would hide the
 * value from a reader that cannot see the chip, which is the half that matters.
 */
function ChipButton({
  label,
  value,
  bad,
  open,
  onClick,
  testId,
  title,
}: {
  label: string;
  value: string | null;
  /** What the address wrote, when the API refused it — shown instead of the value, in no state at all. */
  bad: string | undefined;
  open: boolean;
  onClick: () => void;
  testId: string;
  title?: string;
}) {
  const shown = bad ?? value;
  return (
    <button
      type="button"
      className={`gf-filter-chip${bad !== undefined ? ' is-bad' : value === null ? '' : ' is-set'}`}
      aria-haspopup="true"
      aria-expanded={open}
      title={title}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="gf-filter-key">{label}</span>
      {shown !== null && <span className="gf-filter-value">{shown}</span>}
    </button>
  );
}

/**
 * The popover itself: anchored beneath its chip, closed by `esc` or by a press
 * outside its slot. It starts at the chip's left edge and slides left only as
 * far as it must to stay inside the bar. Where a chip sits depends on how the
 * bar wrapped, so that is measured, never assumed — and measured again as the
 * rows arrive, since the label names come from a read.
 */
function Popover({ children, testId }: { children: React.ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const pop = ref.current;
    const slot = pop?.parentElement;
    const bar = pop?.closest('.gf-filters');
    if (!pop || !slot || !bar) return;
    const place = () => {
      const [at, within] = [slot.getBoundingClientRect(), bar.getBoundingClientRect()];
      setShift(Math.max(within.left, Math.min(at.left, within.right - pop.offsetWidth)) - at.left);
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(pop);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={ref} className="gf-pop" style={{ left: shift }} data-testid={testId}>
      {children}
    </div>
  );
}

/** What a row in an app or project popover offers: `undefined` is "any", `null` is "has none". */
interface Choice {
  value: number | null | undefined;
  label: string;
}

const CHOICE_KEY = (c: Choice) => (c.value === undefined ? 'any' : c.value === null ? 'none' : String(c.value));

function EntityChip({
  which,
  filter,
  bad,
  onChange,
  open,
  onOpen,
  onClose,
}: {
  which: 'app' | 'project';
  filter: TicketFilter;
  bad: string | undefined;
  onChange: (next: TicketFilter) => void;
  open: boolean;
  onOpen: (which: Which) => void;
  onClose: () => void;
}) {
  const names = useNames();
  const apps = useApps(true);
  const projects = useProjects({ archived: true });
  const slot = useRef<HTMLSpanElement>(null);
  useCloseOnOutside(slot, open, onClose);
  const field = which === 'app' ? 'app_id' : 'project_id';
  const chosen = filter[field];
  const label = chosen === undefined ? null : chosen === null ? 'none' : names[which](chosen);

  /**
   * Archived things are out of the way, so they are off the list — unless the
   * address already names one, in which case hiding it would leave a chip
   * nobody can explain. One that is gone entirely still shows, as `#id`.
   */
  const rows = useMemo((): Choice[] => {
    const list: { id: number; name: string; archived_at: string | null }[] = (which === 'app' ? apps.data : projects.data) ?? [];
    const live = list.filter((e) => e.archived_at === null || e.id === chosen);
    const gone = typeof chosen === 'number' && !list.some((e) => e.id === chosen) ? [{ value: chosen, label: `#${chosen}` }] : [];
    return [{ value: undefined, label: 'any' }, { value: null, label: 'none' }, ...live.map((e) => ({ value: e.id, label: e.name })), ...gone];
  }, [which, apps.data, projects.data, chosen]);

  /**
   * ADR-0007 as the picker sees it: a project brings its app, and moving the
   * app away from a project's app drops the project — the same rule the Ticket
   * view follows, so the board cannot describe a placement the API refuses.
   */
  const pick = (value: number | null | undefined) => {
    const next: TicketFilter = { ...filter };
    if (value === undefined) delete next[field];
    else next[field] = value;
    if (which === 'project' && typeof value === 'number') {
      const project = projects.data?.find((p) => p.id === value);
      if (project) next.app_id = project.app_id ?? undefined;
    }
    if (which === 'app' && typeof next.project_id === 'number' && !projectFitsApp(projects.data?.find((p) => p.id === next.project_id), value ?? null))
      delete next.project_id;
    onChange(next);
    onClose();
  };

  return (
    <span className="gf-filter-slot" ref={slot}>
      <ChipButton label={which} value={label} bad={bad} open={open} testId={`chip-${which}`} onClick={() => (open ? onClose() : onOpen(which))} />
      {open && (
        <Popover testId={`pop-${which}`}>
          <SearchRows label={which} rows={rows} chosen={chosen} onPick={pick} onClose={onClose} />
        </Popover>
      )}
    </span>
  );
}

/** The Ticket picker's shape (DESIGN.md Components): an open input bordered `--gf-system` over rows, `↑↓` and `⏎`. */
function SearchRows({
  label,
  rows,
  chosen,
  onPick,
  onClose,
}: {
  label: string;
  rows: Choice[];
  chosen: number | null | undefined;
  onPick: (value: number | null | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const listId = useId();
  const optionId = (c: Choice) => `${listId}-${CHOICE_KEY(c)}`;

  const needle = query.trim().toLowerCase();
  const hits = rows.filter((r) => needle === '' || r.label.toLowerCase().includes(needle));
  const at = Math.min(cursor, Math.max(hits.length - 1, 0));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return e.preventDefault(), onClose();
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[at];
      if (hit) onPick(hit.value);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => {
        const next = Math.min(c, Math.max(hits.length - 1, 0)) + (e.key === 'ArrowDown' ? 1 : -1);
        return (next + hits.length) % Math.max(hits.length, 1);
      });
    }
  };

  return (
    <div className="gf-picker">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={hits.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={hits[at] ? optionId(hits[at]) : undefined}
        aria-label={`filter by ${label} — search`}
        placeholder={`search ${label}s`}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        onKeyDown={onKeyDown}
      />
      {hits.length === 0 ? (
        <p className="gf-empty">nothing matches</p>
      ) : (
        <div id={listId} className="gf-rows gf-picker-hits" role="listbox" aria-label={`${label} candidates`}>
          {hits.map((r, i) => (
            <div
              key={CHOICE_KEY(r)}
              id={optionId(r)}
              role="option"
              aria-selected={i === at}
              className={`gf-row gf-picker-hit${i === at ? ' is-on' : ''}`}
              data-testid={`pick-${label}-${CHOICE_KEY(r)}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => onPick(r.value)}
            >
              <span className="gf-pick-title">{r.label}</span>
              {r.value === chosen && <span className="gf-row-trail">✓</span>}
            </div>
          ))}
        </div>
      )}
      <span className="gf-tile-keys">
        <Hint k="↑↓">move</Hint>
        <Hint k="⏎">pick</Hint>
        <Hint k="esc">close</Hint>
      </span>
    </div>
  );
}

/** `status: ready, building`, or the count once there are more names than a chip can hold. */
function setSummary(names: readonly string[]): string {
  return names.length >= 3 ? String(names.length) : names.join(', ');
}

function StatusChipButton({
  filter,
  bad,
  onChange,
  open,
  onOpen,
  onClose,
}: {
  filter: TicketFilter;
  bad: string | undefined;
  onChange: (next: TicketFilter) => void;
  open: boolean;
  onOpen: (which: Which) => void;
  onClose: () => void;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  useCloseOnOutside(slot, open, onClose);
  const chosen = filter.status ?? DEFAULT_BOARD_STATUSES;
  /** The address carries `status` only when the set differs from the board's default, so equal boards make equal bookmarks. */
  const toggle = (status: TicketStatus) => {
    const next = canonicalStatuses(chosen.includes(status) ? chosen.filter((s) => s !== status) : [...chosen, status]);
    const isDefault = next.length === DEFAULT_BOARD_STATUSES.length && next.every((s) => DEFAULT_BOARD_STATUSES.includes(s));
    const { status: _, ...rest } = filter;
    onChange(isDefault || next.length === 0 ? rest : { ...rest, status: next });
  };

  return (
    <span className="gf-filter-slot" ref={slot}>
      <ChipButton
        label="status"
        value={filter.status === undefined ? null : setSummary(filter.status)}
        bad={bad}
        // the count form is short by design; the whole set is a hover away, so a bookmark stays readable
        title={chosen.join(', ')}
        open={open}
        testId="chip-status"
        onClick={() => (open ? onClose() : onOpen('status'))}
      />
      {open && (
        <Popover testId="pop-status">
          <CheckRows label="status" options={TICKET_STATUSES} chosen={chosen} onToggle={toggle} onClose={onClose} testId={(status) => `check-${status}`} />
        </Popover>
      )}
    </span>
  );
}

/**
 * Check rows over a short set — eight statuses, or the labels in use — with no
 * input, because a list that size is one you read rather than search.
 */
function CheckRows<T extends string>({
  label,
  options,
  chosen,
  onToggle,
  onClose,
  testId,
  empty,
}: {
  label: string;
  options: readonly T[];
  chosen: readonly T[];
  onToggle: (option: T) => void;
  onClose: () => void;
  testId: (option: T) => string;
  /** What an empty set says; it stays inside the group, so `esc` still closes it. */
  empty?: string;
}) {
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  // the rows can change under the cursor (a poll brings a new label), so it is clamped rather than trusted
  const at = Math.min(cursor, Math.max(options.length - 1, 0));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return e.preventDefault(), onClose();
    const option = options[at];
    if (option === undefined) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(option);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
  };

  return (
    // the group takes the focus and `↑↓` moves inside it, so a check row never needs to be tab-reachable
    <div ref={box} className="gf-checks" tabIndex={-1} role="group" aria-label={`filter by ${label}`} onKeyDown={onKeyDown}>
      {options.map((option, i) => (
        <label key={option} className={`gf-check${i === at ? ' is-on' : ''}`} onMouseMove={() => setCursor(i)}>
          <input
            type="checkbox"
            checked={chosen.includes(option)}
            // the cursor follows the click, so `space` afterwards toggles the row you just touched
            onChange={() => {
              setCursor(i);
              onToggle(option);
            }}
            data-testid={testId(option)}
          />
          {option}
        </label>
      ))}
      {options.length === 0 && <p className="gf-empty">{empty}</p>}
      <span className="gf-tile-keys">
        <Hint k="↑↓">move</Hint>
        {/* two keys, one word: the Hint's own clothes, so the pair still wraps and folds as one */}
        <span className="gf-hint">
          <Kbd>space</Kbd> <Kbd>⏎</Kbd> toggle
        </span>
        <Hint k="esc">close</Hint>
      </span>
    </div>
  );
}

/**
 * The `label` chip (ADR-0013): any of these names, as `status` is any of
 * those. Unset is no parameter at all — every ticket is on the board whatever
 * it carries — so it has no default set to compare against.
 */
function LabelChipButton({
  filter,
  bad,
  onChange,
  open,
  onOpen,
  onClose,
}: {
  filter: TicketFilter;
  bad: string | undefined;
  onChange: (next: TicketFilter) => void;
  open: boolean;
  onOpen: (which: Which) => void;
  onClose: () => void;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  useCloseOnOutside(slot, open, onClose);
  const chosen = filter.label ?? [];
  const toggle = (name: string) => {
    const next = chosen.includes(name) ? chosen.filter((l) => l !== name) : canonicalLabels([...chosen, name]);
    const { label: _, ...rest } = filter;
    onChange(next.length === 0 ? rest : { ...rest, label: next });
  };

  return (
    <span className="gf-filter-slot" ref={slot}>
      <ChipButton
        label="label"
        value={filter.label === undefined ? null : setSummary(filter.label)}
        bad={bad}
        title={chosen.length > 0 ? chosen.join(', ') : undefined}
        open={open}
        testId="chip-label"
        onClick={() => (open ? onClose() : onOpen('label'))}
      />
      {open && (
        <Popover testId="pop-label">
          <LabelChecks chosen={chosen} onToggle={toggle} onClose={onClose} />
        </Popover>
      )}
    </span>
  );
}

/**
 * The names in use: every label a live ticket carries, whatever the rest of
 * the Filter says, so the popover is the vocabulary rather than this board's
 * corner of it. A name already chosen is always a row, so one nobody carries
 * any more can still be let go.
 */
function LabelChecks({ chosen, onToggle, onClose }: { chosen: readonly string[]; onToggle: (name: string) => void; onClose: () => void }) {
  const inUse = useLabelNames();
  const names = useMemo(() => canonicalLabels([...chosen, ...(inUse.data ?? [])]), [chosen, inUse.data]);
  return (
    <CheckRows
      label="label"
      options={names}
      chosen={chosen}
      onToggle={onToggle}
      onClose={onClose}
      testId={(name) => `check-label-${name}`}
      empty={inUse.data === undefined ? 'reading labels…' : 'no labels in use'}
    />
  );
}
