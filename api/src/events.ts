import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import type { HistoryStore } from '@goblin/history';
import { eventHistory, type Actor, type EntityKind, type Event, type EventKind } from '@goblin/shared';
import type { AtomicWrite, Db } from './db';
import { event } from './schema';

export const now = () => new Date().toISOString();

/** A number, or the SQL for the newest row when the row is written earlier in the same batch and its id is not known yet. */
type EntityId = number | SQL<number>;

export interface EventInput {
  entity_kind: EntityKind;
  entity_id: EntityId;
  actor: Actor;
  kind: EventKind;
  prior: Record<string, unknown> | null;
  new: Record<string, unknown>;
  at?: string;
}

/** The sentence a failed batch names this write by. `api/src/bulk.ts` maps it back to the failing Ticket. */
const what = (kind: string, entity_kind: string, entity_id: EntityId) => (typeof entity_id === 'number' ? `${kind} event for ${entity_kind} ${entity_id}` : `${kind} event`);

const eventStore = (db: Db): HistoryStore<EntityKind, EventKind, Actor, EntityId, typeof event.$inferSelect, AtomicWrite> => ({
  openSession: async (key, since) => {
    const rows = await db
      .select()
      .from(event)
      .where(
        and(
          eq(event.entity_kind, key.subject_kind),
          eq(event.entity_id, key.subject_id),
          // the actor is part of the key: a planner's rewrite never folds into yours
          eq(event.actor, key.actor),
          eq(event.kind, key.kind),
          gte(event.at, since),
        ),
      )
      .orderBy(desc(event.at), desc(event.id))
      .limit(1);
    return rows[0];
  },
  append: ({ subject_kind, subject_id, ...change }) => ({
    what: what(change.kind, subject_kind, subject_id),
    statement: db
      .insert(event)
      .values({ entity_kind: subject_kind, entity_id: subject_id, ...change })
      .returning({ id: event.id }),
  }),
  // pins the row it read, so a session that moved on in between fails the batch instead of being overwritten
  amend: (open, merged) => ({
    what: what(open.kind, open.entity_kind, open.entity_id),
    statement: db
      .update(event)
      .set(merged)
      .where(and(eq(event.id, open.id), eq(event.at, open.at)))
      .returning({ id: event.id }),
  }),
  list: (subject_kind, subject_id) =>
    db
      .select()
      .from(event)
      .where(and(eq(event.entity_kind, subject_kind), eq(event.entity_id, subject_id))),
});

/**
 * An event as a statement not yet run, for the batch that commits it together
 * with the write it records (ADR-0010). Joining an edit session happens here,
 * in the API, so `goblin` and agents inherit it.
 */
export const eventWrite = (db: Db, { entity_kind, entity_id, at = now(), ...change }: EventInput): Promise<AtomicWrite> =>
  eventHistory.record(eventStore(db), { subject_kind: entity_kind, subject_id: entity_id, at, ...change });

export const listEvents = async (db: Db, kind: EntityKind, id: number): Promise<Event[]> => (await eventHistory.read(eventStore(db), kind, id)) as Event[];
