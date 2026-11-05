import { defineHistory } from '@goblin/history';
import { z } from 'zod';
import { ACTORS, ActorSchema } from './actor';

/**
 * Goblin Foundry's History rules. An `updated` event is an edit session, not a
 * write (ADR-0008): a field on a view is always live, so a two-minute sitting
 * at a design would otherwise leave dozens of rows each holding a whole
 * document. A further edit of the same entity by the same actor within the
 * window amends the open row instead: `prior` stays what the sitting started
 * from — that is what makes it the unit of recovery — while `new` and `at`
 * advance. Every other kind appends.
 */
export const eventHistory = defineHistory({
  // `setting` is the installation itself (entity_id 0) — the prefix change is a write like any other.
  subjects: ['app', 'project', 'ticket', 'setting'],
  // Every write records one event; a status move is `transitioned`, carrying the verb as well as the status pair (ADR-0003).
  kinds: [
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
    // a Ticket in flight given its place by Open terminal; Start carries the same fields on its `transitioned`
    'worktree_recorded',
    // the whole set before and after, one row per change: a label edit is a decision, never folded into an edit session (ADR-0008)
    'labelled',
  ],
  actors: ACTORS,
  sessions: { kinds: ['updated'], windowMs: 5 * 60_000 },
});

export const EventKindSchema = z.enum(eventHistory.kinds);
export type EventKind = z.infer<typeof EventKindSchema>;

export const EntityKindSchema = z.enum(eventHistory.subjects);
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
