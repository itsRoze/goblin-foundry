import { z } from 'zod';
import type { TicketStatus } from './tickets';

/** The implementations the installation can choose between. */
export const TERMINAL_STEPS = ['none', 'herdr'] as const;
export const TERMINAL_STEP_SHAPE = 'none or herdr';
export const TerminalStepSchema = z.enum(TERMINAL_STEPS, { error: TERMINAL_STEP_SHAPE });
export type TerminalStepName = z.infer<typeof TerminalStepSchema>;

/** What asking for a terminal came to. Not opened is an answer, not a failure, and the folder is there to go to by hand. */
export const TerminalOutcomeSchema = z.discriminatedUnion('opened', [
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), reason: z.string(), folder: z.string() }),
]);
export type TerminalOutcome = z.infer<typeof TerminalOutcomeSchema>;

/** A write that may have asked for a terminal: `start` with a body, and Open terminal. A bare `start` carries none. */
export const TerminalAnswerSchema = z.object({ terminal: TerminalOutcomeSchema.optional() });

/** Where a `ready` Ticket offers Start, these offer Open terminal. */
export const opensTerminal = (status: TicketStatus): boolean => status === 'building' || status === 'review';

/** The refusal, in one set of words for the API and the key that does not need to ask it. */
export const noTerminalAt = (key: string, status: TicketStatus): string => `nothing opened — ${key} is ${status}, and only a building or review Ticket opens a terminal`;
