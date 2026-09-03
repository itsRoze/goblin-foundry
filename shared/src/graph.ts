import { z } from 'zod';
import { TicketStatusSchema } from './tickets';

/**
 * Where a ticket at the far end of an edge lives, when that is not this
 * project. Both halves are nullable because a ticket may be an orphan or sit
 * in an app with no project (CONTEXT.md); the popover reads `—` for a missing
 * half, as the kanban card does (DESIGN.md Interaction).
 */
export const GraphExternalSchema = z.object({
  app: z.string().nullable(),
  project: z.string().nullable(),
});
export type GraphExternal = z.infer<typeof GraphExternalSchema>;

/**
 * One diamond. `description_line` is the first non-empty line of the
 * description and never the whole markdown — the popover is a glance, not a
 * reader.
 *
 * An **external** node carries `blocked_by: []` whatever it is really waiting
 * on: the graph is one hop, so what stands behind a ticket outside this
 * project is not something this drawing knows or says. It is context, not
 * subject, and wears no status treatment for the same reason.
 */
export const GraphNodeSchema = z.object({
  key: z.string(),
  title: z.string(),
  status: TicketStatusSchema,
  blocked_by: z.array(z.string()),
  description_line: z.string(),
  external: GraphExternalSchema.optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** A declared edge, by key, blocker first — the direction the arrowless drawing gets from rank order. */
export const GraphEdgeSchema = z.object({ blocker: z.string(), blocked: z.string() });
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/** What `GET /api/projects/:id/graph` answers: only what is drawn (ADR-0009 keeps satisfied edges; cancelled and trashed are gone). */
export const ProjectGraphSchema = z.object({ nodes: z.array(GraphNodeSchema), edges: z.array(GraphEdgeSchema) });
export type ProjectGraph = z.infer<typeof ProjectGraphSchema>;

/** The first line with anything on it, trimmed; `''` when the description is empty or all whitespace. */
export const descriptionLine = (description: string): string =>
  description.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
