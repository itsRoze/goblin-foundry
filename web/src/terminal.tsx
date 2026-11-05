import { useCallback, useEffect, useRef, useState } from 'react';
import { noTerminalAt, opensTerminal, type StartWorktreeBody, type TerminalOutcome, type Ticket, type TicketStatus } from '@goblin/shared';
import { useCopy } from './branch-copy';
import { useOpenTerminal } from './queries';
import { refusalLine } from './ui';

type Opening = Pick<Ticket, 'key' | 'title' | 'app_id' | 'status' | 'worktree_branch' | 'worktree_folder'>;

/** A terminal that did not open, about one Ticket. `from` is where a screen can still say it if the Ticket has since moved out of sight. */
export type TerminalSaid = Extract<TerminalOutcome, { opened: false }> & { key: string; from: TicketStatus };

/**
 * What a screen needs to offer Open terminal: the press, the Start modal's fields
 * for a Ticket with no Worktree to return to, and the line that reports a terminal
 * that did not open. Both screens hold one, so a key and a button on either agree.
 */
export function useTerminal({ guard, refuse }: { guard: <T>(write: () => Promise<T>) => Promise<T>; refuse: (ticket: Pick<Ticket, 'key' | 'status'>, text: string, late: boolean) => void }) {
  const write = useOpenTerminal();
  /** The Ticket the modal is open on, as it was when it opened: a poll must not change what is being decided about. */
  const [choosing, setChoosing] = useState<Opening | null>(null);
  const [said, setSaid] = useState<TerminalSaid | null>(null);
  const dismiss = useCallback(() => setSaid(null), []);

  /** Also what a Start reports through, since it asks for a terminal as its last step. A Start with no Worktree asked for none. */
  const report = useCallback((ticket: Pick<Ticket, 'key' | 'status'>, { terminal }: { terminal?: TerminalOutcome | undefined }) => {
    setSaid(terminal && !terminal.opened ? { ...terminal, key: ticket.key, from: ticket.status } : null);
  }, []);

  const press = (ticket: Opening) => {
    setSaid(null);
    if (!opensTerminal(ticket.status)) return refuse(ticket, noTerminalAt(ticket.key, ticket.status), false);
    if (ticket.worktree_folder === null) return setChoosing(ticket);
    void guard(() => write.mutateAsync({ key: ticket.key })).then(
      (answer) => report(ticket, answer),
      (e: unknown) => refuse(ticket, refusalLine(e), true),
    );
  };
  /** What the modal runs: a refusal stays in its panel, so this one is left to reject. */
  const choose = (ticket: Opening, worktree?: StartWorktreeBody) => guard(() => write.mutateAsync({ key: ticket.key, worktree })).then((answer) => report(ticket, answer));

  return { press, choosing, choose, done: useCallback(() => setChoosing(null), []), said, dismiss, report };
}

/**
 * Said in place, with no timer because it carries a button, and it goes the way a
 * board's move notice goes: `esc`, which the screen answers, or a press anywhere
 * else. The folder is the way forward, so it can be copied from here.
 */
export function TerminalNotOpened({ said, onDismiss }: { said: TerminalSaid; onDismiss: () => void }) {
  const { copied, failed, copy } = useCopy(said.folder);
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!line.current?.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onDismiss]);
  return (
    <div ref={line} className="gf-terminal-said" role="status" data-testid="terminal-said">
      <span>{said.reason}</span>
      <div className="gf-branch">
        <code className="gf-branch-name" data-testid="terminal-folder">
          {said.folder}
        </code>
        <button type="button" className="gf-btn" aria-label="copy terminal folder" onClick={() => void copy()}>
          {copied ? 'copied' : 'copy folder'}
        </button>
      </div>
      {failed && (
        <p className="gf-refusal" role="alert">
          Couldn’t copy. Select the folder above and copy it manually.
        </p>
      )}
    </div>
  );
}
