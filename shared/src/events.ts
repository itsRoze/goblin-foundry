import { z } from 'zod';
import { ActorSchema } from './actor';

/** Every write records one event; a status move is `transitioned`, carrying the verb as well as the status pair (ADR-0003). */
export const EventKindSchema = z.enum([
  'created',
  'updated',
  'archived',
  'unarchived',
  'trashed',
  'restored',
  'transitioned',
  // an edge is written on both its ends, so either ticket's history tells the whole story (ADR-0009)
  'dependency_added',
  'dependency_removed',
  'implementation_link_added',
  'implementation_link_removed',
]);
export type EventKind = z.infer<typeof EventKindSchema>;

/** `setting` is the installation itself (entity_id 0) — the prefix change is a write like any other. */
export const EntityKindSchema = z.enum(['app', 'project', 'ticket', 'setting']);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/** `prior`/`new` hold only the fields that changed; `prior` is null on create. */
export const EventSchema = z.object({
  id: z.number().int(),
  entity_kind: EntityKindSchema,
  entity_id: z.number().int(),
  actor: ActorSchema,
  kind: EventKindSchema,
  prior: z.record(z.string(), z.unknown()).nullable(),
  new: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type Event = z.infer<typeof EventSchema>;
