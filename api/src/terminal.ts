import { eq } from 'drizzle-orm';
import { ticketKey, type TerminalOutcome, type TerminalStepName } from '@goblin/shared';
import type { Db } from './db';
import { herdrTerminal } from './herdr';
import { app as appTable, type TicketRow } from './schema';
import { readSettings } from './settings';

export interface TerminalRequest {
  /** The App's Checkout too, when it has one, for a terminal that shows a Ticket's Worktree beside the repository it came from. */
  app: { name: string; checkout: string | null };
  ticket: { key: string; title: string };
  folder: string;
}

/**
 * The one replaceable part of Start: open a terminal in a Ticket's Worktree,
 * reusing a live one for that Ticket in that folder. Start depends on this and on no terminal
 * in particular, and which implementation answers is an installation setting.
 */
export interface TerminalStep {
  open(request: TerminalRequest): Promise<TerminalOutcome>;
}

export type TerminalSteps = Record<TerminalStepName, TerminalStep>;

/** For someone with no terminal to drive: nothing opens, and the folder is what they go to. */
export const noTerminal: TerminalStep = {
  open: async ({ folder }) => ({ opened: false, reason: 'the terminal step is none, so no terminal was opened', folder }),
};

/** The App a Ticket belongs to, if it belongs to one. */
export const appOfTicket = async (db: Db, { app_id }: Pick<TicketRow, 'app_id'>) => (app_id === null ? undefined : (await db.select().from(appTable).where(eq(appTable.id, app_id)))[0]);

export const BUILT_TERMINAL_STEPS: TerminalSteps = { none: noTerminal, herdr: herdrTerminal() };

/**
 * Asks the chosen step, after whatever the request was for has already happened.
 * Nothing here is an error status: the Start or the Worktree stands, so a step
 * that cannot answer, or throws, is only a terminal that did not open.
 */
export async function openTerminal(db: Db, steps: TerminalSteps, ticket: TicketRow, folder: string): Promise<TerminalOutcome> {
  const { ticket_prefix, terminal_step } = await readSettings(db);
  const key = ticketKey(ticket_prefix, ticket.id);
  const app = await appOfTicket(db, ticket);
  if (!app) return { opened: false, reason: `${key} has no App, so no terminal was opened`, folder };
  try {
    return await steps[terminal_step].open({ app: { name: app.name, checkout: app.checkout }, ticket: { key, title: ticket.title }, folder });
  } catch (e) {
    return { opened: false, reason: e instanceof Error ? e.message : String(e), folder };
  }
}
