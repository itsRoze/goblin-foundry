import { z } from 'zod';
import { ActorSchema } from './actor';

/** Every write records one event. `transitioned` arrives with the ticket lifecycle (issue 03). */
export const EventKindSchema = z.enum(['created', 'updated', 'archived', 'unarchived', 'trashed', 'restored']);
export type EventKind = z.infer<typeof EventKindSchema>;

export const EntityKindSchema = z.enum(['app', 'project', 'ticket']);
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
