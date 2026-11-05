import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { defaultWorktreeBranch, slugPath, worktreeBase, type App, type AppBranches, type CheckoutBranch, type StartWorktreeBody, type Ticket } from '@goblin/shared';
import { byKey, ignoreHeldEnter } from './keys';
import { useApp, useAppBranches } from './queries';
import { baseChoices, branchChoices, branchNote, matching, planBranch, planLine } from './start-plan';
import { Empty, ForPointer, Kbd, refusalLine } from './ui';

type Starting = Pick<Ticket, 'key' | 'title' | 'app_id' | 'worktree_branch'>;

/**
 * Starting one `ready` Ticket (GLOSSARY.md "Worktree"): where the work will
 * happen is decided here, before anything is made. It is the screen's own write
 * that runs, so a bulk action's hold and the board's notice go on working, and
 * `run` with no body is the plain Transition. Open terminal on a Ticket already in
 * flight with no Worktree asks the same fields without the Transition, so there is
 * no plain way past them: with nothing to make, there is nothing to do.
 *
 * A native modal dialog, so the page behind is inert and Tab stays inside. No
 * backdrop is drawn, as the palette draws none (DESIGN.md Components); a press
 * outside it is a cancel, the same as the palette. Its keys never reach the
 * screen behind it. A refusal here stays until the next try, unlike the one that
 * clears itself on a board: the fields hold the words it refused, as a field's
 * refused save does (DESIGN.md Components, Start modal).
 */
export function StartModal({
  ticket,
  verb = 'start',
  run,
  onClose,
  home,
}: {
  ticket: Starting;
  verb?: 'start' | 'terminal';
  run: (worktree?: StartWorktreeBody) => Promise<unknown>;
  onClose: (started: boolean) => void;
  /**
   * The control the operator came from, as the screen finds it now: the state tile's `start` or `open terminal`, or
   * the card. Named by the screen and not read off the page, because a key, a menu's row, a drag and the palette
   * leave the focus in four places, and in WebKit a click on a button leaves it on `body`.
   */
  home: () => HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const said = useId();
  const app = useApp(ticket.app_id);
  const checkout = app.data?.checkout ?? null;
  const read = useAppBranches(checkout === null ? null : ticket.app_id);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  useLayoutEffect(() => {
    const open = dialog.current;
    open?.showModal();
    return () => {
      if (open?.open) open.close();
    };
  }, []);

  const leave = useCallback(
    (started: boolean) => {
      dialog.current?.close();
      // a key's close brings the control back by what it is clipped, as a picker's close does (`useFocusOnClose`)
      const back = home();
      back?.focus({ preventScroll: true });
      if (byKey(window.event)) back?.scrollIntoView({ block: 'nearest' });
      onClose(started);
    },
    [home, onClose],
  );
  const cancel = useCallback(() => {
    if (!sending.current) leave(false);
  }, [leave]);
  const accept = useCallback(
    async (worktree?: StartWorktreeBody) => {
      if (sending.current) return;
      sending.current = true;
      setBusy(true);
      setRefusal(null);
      try {
        await run(worktree);
        sending.current = false;
        leave(true);
      } catch (e) {
        sending.current = false;
        setBusy(false);
        setRefusal(refusalLine(e));
      }
    },
    [run, leave],
  );

  const missing =
    ticket.app_id === null
      ? `${ticket.key} has no App, so it has no Checkout to make a Worktree of`
      : app.isError
        ? refusalLine(app.error)
        : app.data && checkout === null
          ? `${app.data.name} has no Checkout, so ${ticket.key} cannot be given a Worktree`
          : read.isError
            ? refusalLine(read.error)
            : checkout !== null && read.data?.has_commit === false
              ? `the Checkout ${checkout} has no commit yet, so ${ticket.key} cannot be given a Worktree`
              : null;

  return (
    <dialog
      ref={dialog}
      className="gf-start"
      aria-labelledby={title}
      aria-describedby={missing !== null ? said : undefined}
      tabIndex={-1}
      data-testid="start-modal"
      // a repeat of the `⏎` that opened it has not read it (GF-82)
      onKeyDownCapture={(e) => {
        if (e.key !== 'Enter' || !e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        // a field whose list was open has already spent this `esc`
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          cancel();
        } else if (e.key === 'Tab') {
          // a modal dialog alone lets Tab out to the browser's own controls, and the focus lands on `body`, where the keys are the board's
          const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button, a[href]')];
          const edge = stops[e.shiftKey ? 0 : stops.length - 1];
          const next = stops[e.shiftKey ? stops.length - 1 : 0];
          if (document.activeElement === edge || document.activeElement === e.currentTarget) {
            e.preventDefault();
            next?.focus();
          }
        }
      }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // the press's own focus change comes after this handler, and would take the focus back off `home` to `body`
        e.preventDefault();
        cancel();
      }}
      // what asks a dialog to close without a key, such as a phone's back gesture
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <div className="gf-start-panel">
        <h2 id={title} className="gf-start-title">
          <span className="gf-key">
            {verb === 'start' ? 'start' : 'open terminal'} {ticket.key}
          </span>{' '}
          {ticket.title}
        </h2>
        {missing !== null ? (
          <NoWorktree said={missing} saidId={said} app={app.data} busy={busy} refusal={refusal} onPlain={verb === 'start' ? () => void accept() : undefined} onCancel={cancel} onLeave={() => leave(false)} />
        ) : app.data ? (
          <Fields ticket={ticket} verb={verb} app={app.data} read={read.data} busy={busy} refusal={refusal} onAccept={(worktree) => void accept(worktree)} onCancel={cancel} onRefuse={setRefusal} />
        ) : (
          <Empty>loading…</Empty>
        )}
      </div>
    </dialog>
  );
}

/**
 * A Start that landed takes the control it came from away with the Ticket's old status (the state tile's `start`,
 * the card in `ready`), and the focus with it, once the screen draws the Ticket where it went, after the modal
 * has closed. So the focus is owed until the screen shows the Ticket `moved`, and then lands on `home` as it is
 * found again: `open terminal` where `start` was, as the focus that fell with a question's answers lands on its
 * line, and the card in its new column, as the Cursor follows a Transition (DESIGN.md Interaction). Only from
 * `body`: a terminal that did not open has given it to its `copy folder`. Returns what to call with the Ticket's key.
 */
export function useFocusAfterStart(home: (key: string) => HTMLElement | null, moved: (key: string) => boolean) {
  const [owed, setOwed] = useState<string | null>(null);
  const landed = owed !== null && moved(owed);
  useEffect(() => {
    if (owed === null || !landed) return;
    setOwed(null);
    if (document.activeElement === document.body) home(owed)?.focus({ preventScroll: true });
  }, [owed, landed, home]);
  return setOwed;
}

/** Refused in the panel, and not only by the API: a blank field has nothing to ask it. */
const NO_BRANCH = 'a Worktree needs a branch: name one';

function Fields({
  ticket,
  verb,
  app,
  read,
  busy,
  refusal,
  onAccept,
  onCancel,
  onRefuse,
}: {
  ticket: Starting;
  verb: 'start' | 'terminal';
  app: App;
  /** `undefined` while the Checkout is being read: `⏎` still starts, because the API's defaults are what the fields would have said. */
  read: AppBranches | undefined;
  busy: boolean;
  refusal: string | null;
  onAccept: (worktree: StartWorktreeBody) => void;
  onCancel: () => void;
  onRefuse: (sentence: string) => void;
}) {
  const [branch, setBranch] = useState(() => defaultWorktreeBranch(ticket));
  /** `null` until it is touched, because what it defaults to comes in with the read. */
  const [typedBase, setTypedBase] = useState<string | null>(null);
  const base = typedBase ?? worktreeBase(undefined, app) ?? read?.default ?? '';
  const plan = read ? planBranch(branch, read) : null;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    // typing replaces the suggestion, and `⏎` takes it as it is
    input.current?.select();
  }, []);

  const accept = () => {
    const name = branch.trim();
    if (name === '') return onRefuse(NO_BRANCH);
    onAccept({ branch: name, ...(plan?.kind === 'new' && base.trim() !== '' ? { base: base.trim() } : {}) });
  };

  /** One list at a time: the field that has it, whether what was typed narrows it, and the highlighted row, which starts on nothing so `⏎` starts the Ticket. */
  const [list, setList] = useState<{ field: 'branch' | 'base'; narrowed: boolean; at: number } | null>(null);
  const listId = useId();
  const lineId = useId();
  const rows = useRef<HTMLDivElement>(null);
  const choices = !read || !list ? [] : list.field === 'branch' ? branchChoices(read) : baseChoices(read);
  const hits = list?.narrowed ? matching(choices, list.field === 'branch' ? branch : base) : choices;
  const showing = list !== null && hits.length > 0;
  const optionId = (at: number) => `${listId}-${String(at)}`;
  useEffect(() => {
    rows.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
  }, [list?.at]);

  const pick = (choice: CheckoutBranch) => {
    if (list?.field === 'branch') setBranch(choice.name);
    else setTypedBase(choice.name);
    setList(null);
  };

  const field = (name: 'branch' | 'base', value: string, change: (text: string) => void) => {
    const here = list?.field === name;
    return {
      value,
      role: 'combobox',
      'aria-expanded': here && showing,
      'aria-controls': here && showing ? listId : undefined,
      'aria-autocomplete': 'list' as const,
      'aria-activedescendant': here && showing && list.at >= 0 ? optionId(list.at) : undefined,
      autoComplete: 'off',
      autoCapitalize: 'off',
      spellCheck: false,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        change(e.target.value);
        setList({ field: name, narrowed: true, at: -1 });
      },
      onClick: () => {
        if (!here || !showing) setList({ field: name, narrowed: false, at: -1 });
      },
      onBlur: () => setList(null),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const chosen = here && list.at >= 0 && !(e.metaKey || e.ctrlKey) ? hits[list.at] : undefined;
          if (chosen) pick(chosen);
          else accept();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          // `↓` opens on the row that is set, as a reopened picker does (DESIGN.md Interaction)
          if (!here || !showing) return setList({ field: name, narrowed: false, at: step === 1 ? Math.max(0, !read ? 0 : (name === 'branch' ? branchChoices(read) : baseChoices(read)).findIndex((b) => b.name === value.trim())) : -1 });
          const count = hits.length;
          setList({ ...list, at: list.at === -1 && step === -1 ? count - 1 : (list.at + step + count) % count });
        } else if (e.key === 'Escape' && here && showing) {
          e.preventDefault();
          setList(null);
        }
      },
    };
  };

  return (
    <>
      <label className="gf-field">
        <span>branch</span>
        <input ref={input} type="text" aria-describedby={lineId} {...field('branch', branch, setBranch)} />
      </label>
      <p id={lineId} className="gf-start-note" data-testid="start-line" aria-live="polite">
        {!read ? 'reading the Checkout…' : plan ? planLine(plan) : 'no branch named'}
      </p>
      {plan?.kind === 'new' && (
        <label className="gf-field">
          <span>base</span>
          <input type="text" {...field('base', base, setTypedBase)} />
        </label>
      )}
      <div className="gf-field">
        <span>folder</span>
        <code className="gf-branch-name" data-testid="start-folder">
          {plan?.folder ?? '—'}
        </code>
      </div>
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
      <span className="gf-form-actions">
        {/* a tabindex, or WebKit's Tab skips a button and leaves the dialog for `body` (DESIGN.md Refusal and confirm) */}
        <button type="button" tabIndex={0} className="gf-btn is-primary" data-testid="start-go" aria-busy={busy} onClick={accept}>
          {verb === 'start' ? (busy ? 'starting…' : 'start') : busy ? 'opening…' : 'open terminal'} <Kbd>⏎</Kbd>
        </button>
        <button type="button" tabIndex={0} className="gf-btn" data-testid="start-cancel" aria-disabled={busy} onClick={onCancel}>
          cancel <Kbd>esc</Kbd>
        </button>
        {read && read.branches.length > 0 && !showing && (
          <span className="gf-start-hint">
            <ForPointer fine={<><Kbd>↓</Kbd> list</>} coarse="tap a field for its list" />
          </span>
        )}
      </span>
      {/* at the foot, so nothing above moves under a press when it comes and goes (LESSONS 2026-08-30) */}
      {showing && read && (
        <>
        <div className="gf-start-choices-head">
          <span>{list.field}</span>
          <span className="gf-start-hint">
            <ForPointer fine={<><Kbd>↑↓</Kbd> <Kbd>⏎</Kbd> <Kbd>esc</Kbd></>} />
          </span>
        </div>
        <div ref={rows} id={listId} className="gf-rows gf-start-choices" role="listbox" aria-label="choices">
          {hits.map((choice, at) => (
            <div
              key={choice.name}
              id={optionId(at)}
              role="option"
              aria-selected={at === list.at}
              className={`gf-row gf-picker-hit${at === list.at ? ' is-on' : ''}`}
              onMouseMove={() => {
                if (at !== list.at) setList({ ...list, at });
              }}
              // the field keeps the caret, or its blur would take the list away before the click lands
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(choice)}
            >
              <span className="gf-pick-title">{choice.name}</span>
              <span className="gf-row-trail">
                <span className="gf-palette-note">{branchNote(choice, read)}</span>
              </span>
            </div>
          ))}
        </div>
        </>
      )}
    </>
  );
}

/**
 * No Worktree can be made, which is said, with a way to fix that and a way past it. It is the house's
 * question in a panel, so the safe answer takes the focus: `⏎` on a sentence not yet read writes nothing,
 * and the way past is one ⇧Tab away (DESIGN.md Refusal and confirm).
 */
function NoWorktree({
  said,
  saidId,
  app,
  busy,
  refusal,
  onPlain,
  onCancel,
  onLeave,
}: {
  said: string;
  saidId: string;
  app: App | undefined;
  busy: boolean;
  refusal: string | null;
  /** Absent where a Worktree was all that was asked for. */
  onPlain: (() => void) | undefined;
  onCancel: () => void;
  onLeave: () => void;
}) {
  const answer = useRef<HTMLButtonElement>(null);
  useEffect(() => answer.current?.focus({ preventScroll: true }), []);
  return (
    <>
      <p id={saidId} className="gf-start-said">{said}</p>
      {refusal && (
        <p className="gf-refusal" role="alert">
          {refusal}
        </p>
      )}
      <span className="gf-form-actions">
        {app && (
          <Link tabIndex={0} className="gf-btn" data-testid="start-app-link" to={slugPath('apps', app)} onClick={onLeave}>
            go to {app.name}
          </Link>
        )}
        {onPlain && (
          <button type="button" tabIndex={0} className="gf-btn" data-testid="start-plain" aria-busy={busy} aria-describedby={saidId} onKeyDown={ignoreHeldEnter} onClick={onPlain}>
            {busy ? 'starting…' : 'start without a Worktree'}
          </button>
        )}
        <button ref={answer} type="button" tabIndex={0} className="gf-btn" data-testid="start-cancel" aria-disabled={busy} aria-describedby={saidId} onKeyDown={ignoreHeldEnter} onClick={onCancel}>
          cancel <Kbd>esc</Kbd>
        </button>
      </span>
    </>
  );
}
