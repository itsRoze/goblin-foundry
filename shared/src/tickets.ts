import { z } from 'zod';

/**
 * Workflow state only, in lifecycle order (ADR-0003). `needs_human` arrives
 * with the controller (S5); the order here is the order of the kanban columns.
 */
export const TICKET_STATUSES = ['backlog', 'todo', 'planning', 'ready', 'building', 'review', 'done', 'cancelled'] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/** `key` is derived from the installation prefix and the id; only the id is stored (ADR-0002). */
export const TicketSchema = z.object({
  id: z.number().int(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status: TicketStatusSchema,
  simple: z.boolean(),
  design: z.string().nullable(),
  app_id: z.number().int().nullable(),
  project_id: z.number().int().nullable(),
  trashed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Ticket = z.infer<typeof TicketSchema>;

const ticketFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(100_000),
  design: z.string().max(200_000).nullable(),
  simple: z.boolean(),
  app_id: z.number().int().nullable(),
  project_id: z.number().int().nullable(),
};

/** A title is the only requirement; everything else can be decided later. */
export const CreateTicketBodySchema = z.strictObject({
  title: ticketFields.title,
  description: ticketFields.description.optional(),
  status: TicketStatusSchema.optional(),
  simple: ticketFields.simple.optional(),
  app_id: ticketFields.app_id.optional(),
  project_id: ticketFields.project_id.optional(),
});
export type CreateTicketBody = z.infer<typeof CreateTicketBodySchema>;

export const STATUS_IS_NOT_AN_EDIT = 'status moves through a transition, not an edit (ADR-0003)';

/** Editing a ticket's fields never changes its status (ADR-0003), so `status` here is a 422. */
export const PatchTicketBodySchema = z.strictObject({
  title: ticketFields.title.optional(),
  description: ticketFields.description.optional(),
  design: ticketFields.design.optional(),
  simple: ticketFields.simple.optional(),
  app_id: ticketFields.app_id.optional(),
  project_id: ticketFields.project_id.optional(),
  status: z.undefined(STATUS_IS_NOT_AN_EDIT).optional(),
});
export type PatchTicketBody = z.infer<typeof PatchTicketBodySchema>;

export const ticketKey = (prefix: string, id: number) => `${prefix}-${id}`;

/**
 * Lenient by design: `GF-7`, a stale `SR-7` and a bare `7` all resolve to
 * ticket 7 — the number is the identity, the prefix is decoration (ADR-0002).
 * Responses always carry the canonical key.
 */
export function parseTicketKey(param: string): number | null {
  const m = /^(?:[A-Za-z0-9]+-)?(\d+)$/.exec(param);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
