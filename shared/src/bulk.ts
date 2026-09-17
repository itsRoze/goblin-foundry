import { z } from 'zod';
import { TicketSchema } from './tickets';
import { TRANSITION_NAMES } from './transitions';

/**
 * Where a bulk move sends a Selection (issue 03b), named rather than spelled
 * as fields so a batch can never become a generic edit: a Project brings its
 * App and an App drops the Project (ADR-0007), `no-project` keeps each
 * Ticket's App, and `nowhere` clears both.
 */
export const BulkMoveTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('project'), id: z.number().int() }),
  z.strictObject({ kind: z.literal('app'), id: z.number().int() }),
  z.strictObject({ kind: z.literal('no-project') }),
  z.strictObject({ kind: z.literal('nowhere') }),
]);
export type BulkMoveTarget = z.infer<typeof BulkMoveTargetSchema>;

/** The three things a Selection can have done to it. A transition is still a *named* intent (ADR-0004) — there is no status here to set. */
export const BulkActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('transition'), name: z.enum(TRANSITION_NAMES) }),
  z.strictObject({ kind: z.literal('move'), to: BulkMoveTargetSchema }),
  z.strictObject({ kind: z.literal('trash') }),
]);
export type BulkAction = z.infer<typeof BulkActionSchema>;

/** How many Tickets one batch may name. The board is a few hundred at most; this is the ceiling, not the expectation. */
export const BULK_MAX_TICKETS = 500;

/** One action on an explicit set of Tickets, all or none (ADR-0010). Keys are as lenient as everywhere else (ADR-0002). */
export const BulkTicketsBodySchema = z.strictObject({
  tickets: z.array(z.string().trim().min(1)).min(1).max(BULK_MAX_TICKETS),
  action: BulkActionSchema,
});
export type BulkTicketsBody = z.infer<typeof BulkTicketsBodySchema>;

/** Why one member of the set stops the whole batch. */
export const BulkRefusalSchema = z.object({ key: z.string(), reason: z.string() });
export type BulkRefusal = z.infer<typeof BulkRefusalSchema>;

/** What a batch answers when it commits: every Ticket in the set, as it now stands. */
export const BulkResultSchema = z.object({ tickets: z.array(TicketSchema) });
export type BulkResult = z.infer<typeof BulkResultSchema>;
