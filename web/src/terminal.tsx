import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { noTerminalAt, opensTerminal, type StartWorktreeBody, type TerminalOutcome, type Ticket, type TicketStatus } from '@goblin/shared';
import { useCopy } from './copy';
import { byPointer, ignoreHeldEnter, useFocusOnAsk } from './keys';
import { useOpenTerminal } from './queries';
import { StartModal } from './start-modal';
import { refusalLine } from './ui';

type Opening = Pick<Ticket, 'key' | 'title' | 'app_id' | 'status' | 'worktree_branch' | 'worktree_folder'>;

/** A terminal that did not open, about one Ticket. `from` is where a screen can still say it if the Ticket has since moved out of sight. */
export type TerminalSaid = Extract<TerminalOutcome, { opened: false }> & { key: string; from: TicketStatus; byPointer: boolean };

/**
 * What a screen needs to offer Open terminal: the press, the Start modal's fields
 * for a Ticket with no Worktree to return to, and the line that reports a terminal
 * that did not open. Both screens hold one, so a key and a button on either agree.
 */
export function useTerminal({
  guard = (write) => write(),
  refuse,
  home,
}: {
  /** What a bulk action's hold goes through, on a screen that has one. */
  guard?: <T>(write: () => Promise<T>) => Promise<T>;
  refuse: (ticket: Pick<Ticket, 'key' | 'status'>, text: string, late: boolean) => void;
  /** Where the focus goes when the line that holds it is dismissed. */
  home: (key: string) => HTMLElement | null;
}) {
  const write = useOpenTerminal();
  /** The Ticket the modal is open on, as it was when it opened: a poll must not change what is being decided about. */
  const [choosing, setChoosing] = useState<Opening | null>(null);
  const [said, setSaid] = useState<TerminalSaid | null>(null);
  const dismiss = useCallback(() => {
    if (said && document.activeElement?.closest('.gf-terminal-said')) home(said.key)?.focus({ preventScroll: true });
    setSaid(null);
  }, [said, home]);

  /**
   * Also what a Start reports through, since it asks for a terminal as its last step. A Start with no Worktree asked
   * for none. Called as the press goes out and answered when the write comes back, by which time the press is over.
   */
  const reporting = useCallback((ticket: Pick<Ticket, 'key' | 'status'>) => {
    const pointer = byPointer(window.event);
    return ({ terminal }: { terminal?: TerminalOutcome | undefined }) => {
      setSaid(terminal && !terminal.opened ? { ...terminal, key: ticket.key, from: ticket.status, byPointer: pointer } : null);
    };
  }, []);

  const press = (ticket: Opening) => {
    setSaid(null);
    if (!opensTerminal(ticket.status)) return refuse(ticket, noTerminalAt(ticket.key, ticket.status), false);
    if (ticket.worktree_folder === null) return setChoosing(ticket);
    void guard(() => write.mutateAsync({ key: ticket.key })).then(
      reporting(ticket),
      (e: unknown) => refuse(ticket, refusalLine(e), true),
    );
  };
  /** What the modal runs: a refusal stays in its panel, so this one is left to reject. */
  const choose = (ticket: Opening, worktree?: StartWorktreeBody) => guard(() => write.mutateAsync({ key: ticket.key, worktree })).then(reporting(ticket));

  return { press, choosing, choose, done: useCallback(() => setChoosing(null), []), home, said, dismiss, reporting };
}

/** The Start modal's fields for a Ticket in flight with no Worktree to return to, while one is being chosen. */
export function ChooseWorktree({ terminal: { choosing, choose, done, home } }: { terminal: ReturnType<typeof useTerminal> }) {
  if (!choosing) return null;
  return <StartModal ticket={choosing} verb="terminal" run={(worktree) => choose(choosing, worktree)} onClose={done} focusAfter={() => home(choosing.key)} />;
}

/**
 * Said in place, with no timer because it carries a button, and it goes the way a
 * board's move notice goes: `esc`, which the screen answers, or a click anywhere
 * else. The folder is the way forward, so the copy takes the focus, once, as a
 * question's answer does (DESIGN.md Refusal and confirm); behind a Start modal the
 * page is inert, so that waits for the modal to have closed.
 */
export function TerminalNotOpened({ said, onDismiss }: { said: TerminalSaid; onDismiss: () => void }) {
  const { copied, failed, copy } = useCopy(said.folder);
  const line = useRef<HTMLDivElement>(null);
  const answer = useRef<HTMLButtonElement>(null);
  const reason = useId();
  const [behindModal, setBehindModal] = useState(() => document.querySelector('dialog:modal') !== null);
  useEffect(() => {
    const modal = document.querySelector('dialog:modal');
    if (!modal) return setBehindModal(false);
    const closed = () => setBehindModal(false);
    modal.addEventListener('close', closed, { once: true });
    return () => modal.removeEventListener('close', closed);
  }, []);
  useFocusOnAsk(behindModal ? null : said, answer, line, said);
  useEffect(() => {
    // on the click and not the press: the line taking its height away between the two would move what the press was aimed at
    const onClick = (e: MouseEvent) => {
      if (!line.current?.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [onDismiss]);
  return (
    <div ref={line} className="gf-terminal-said" role="status" data-testid="terminal-said">
      <span id={reason}>{said.reason}</span>
      <div className="gf-branch">
        <code className="gf-branch-name" data-testid="terminal-folder">
          {said.folder}
        </code>
        {/* a `tabindex` is what puts a button in WebKit's Tab order without full keyboard access on, as a question's answers carry it */}
        <button ref={answer} type="button" tabIndex={0} className="gf-btn" aria-label="copy folder of this terminal" aria-describedby={reason} onKeyDown={ignoreHeldEnter} onClick={() => void copy()}>
          {copied ? 'copied' : 'copy folder'}
        </button>
      </div>
      <span className="gf-implementation-notice" role="status">
        {copied ? 'terminal folder copied' : ''}
      </span>
      {failed && (
        <p className="gf-refusal" role="alert">
          Couldn’t copy. Select the folder above and copy it manually.
        </p>
      )}
    </div>
  );
}
