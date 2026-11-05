import { eq } from 'drizzle-orm';
import { ticketKey, type TerminalOutcome, type TerminalStepName } from '@goblin/shared';
import type { Db } from './db';
import { app as appTable, type TicketRow } from './schema';
import { readSettings } from './settings';

export interface TerminalRequest {
  app: { id: number; name: string };
  ticket: { key: string; title: string };
  folder: string;
}

/**
 * The one replaceable part of Start: open a terminal in a Ticket's Worktree,
 * reusing a live one for that Ticket. Start depends on this and on no terminal
 * in particular, and which implementation answers is an installation setting.
 */
export interface TerminalStep {
  open(request: TerminalRequest): Promise<TerminalOutcome>;
}

/** The implementations this build has. `none` is always one, because it is what a fresh installation has chosen. */
export type TerminalSteps = { none: TerminalStep } & Partial<Record<TerminalStepName, TerminalStep>>;

/** For someone with no terminal to drive: nothing opens, and the folder is what they go to. */
export const noTerminal: TerminalStep = {
  open: async ({ folder }) => ({ opened: false, reason: 'the terminal step is none, so no terminal was opened', folder }),
};

export const BUILT_TERMINAL_STEPS: TerminalSteps = { none: noTerminal };

/**
 * Asks the chosen step, after whatever the request was for has already happened.
 * Nothing here is an error status: the Start or the Worktree stands, so a step
 * that cannot answer, or throws, is only a terminal that did not open.
 */
export async function openTerminal(db: Db, steps: TerminalSteps, ticket: TicketRow, folder: string): Promise<TerminalOutcome> {
  const { ticket_prefix, terminal_step } = await readSettings(db);
  const key = ticketKey(ticket_prefix, ticket.id);
  const [app] = ticket.app_id === null ? [] : await db.select().from(appTable).where(eq(appTable.id, ticket.app_id));
  if (!app) return { opened: false, reason: `${key} has no App, so no terminal was opened`, folder };
  const step = steps[terminal_step];
  if (!step) return { opened: false, reason: `the terminal step ${terminal_step} is not built here`, folder };
  try {
    return await step.open({ app: { id: app.id, name: app.name }, ticket: { key, title: ticket.title }, folder });
  } catch (e) {
    return { opened: false, reason: e instanceof Error ? e.message : String(e), folder };
  }
}
