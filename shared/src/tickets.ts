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
  /** The keys of the blockers that are still *open* — a derived condition, never a status (CONTEXT.md "Blocked"). */
  blocked_by: z.array(z.string()),
});
export type Ticket = z.infer<typeof TicketSchema>;

/** Enough of the other end of an edge to render a chip without a second read. */
export const DependencyRefSchema = z.object({
  key: z.string(),
  title: z.string(),
  status: TicketStatusSchema,
});
export type DependencyRef = z.infer<typeof DependencyRefSchema>;

/** Both directions of a ticket's declared edges — *every* one of them, satisfied or not (ADR-0009). */
export const TicketDependenciesSchema = z.object({
  depends_on: z.array(DependencyRefSchema),
  blocks: z.array(DependencyRefSchema),
});
export type TicketDependencies = z.infer<typeof TicketDependenciesSchema>;

/** What a single-ticket read answers: the ticket plus the neighbourhood a list read cannot afford. */
export const TicketDetailSchema = TicketSchema.extend({ dependencies: TicketDependenciesSchema });
export type TicketDetail = z.infer<typeof TicketDetailSchema>;

/** The blocker is named by key, because the ticket view's picker deals in keys (ADR-0002). */
export const AddDependencyBodySchema = z.strictObject({ blocker: z.string().trim().min(1) });
export type AddDependencyBody = z.infer<typeof AddDependencyBodySchema>;

/**
 * Blockedness is a property of a *non-terminal* ticket: `done` and `cancelled`
 * have nowhere left to proceed to, so they are never blocked however many open
 * blockers they still name (CONTEXT.md "Blocked").
 */
export const isBlocked = (t: Pick<Ticket, 'status' | 'blocked_by'>): boolean =>
  t.blocked_by.length > 0 && t.status !== 'done' && t.status !== 'cancelled';

/** *GF-3 and GF-7 still block this* — the one sentence the `start` confirm asks with. */
export const blockedWarning = (keys: string[]): string =>
  `${keys.length === 1 ? keys[0] : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`} still ${keys.length === 1 ? 'blocks' : 'block'} this`;

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
