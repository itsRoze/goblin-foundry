import { and, desc, eq, gte } from 'drizzle-orm';
import type { Actor, EntityKind, Event, EventKind } from '@goblin/shared';
import type { Db } from './db';
import { event } from './schema';

export const now = () => new Date().toISOString();

export interface EventInput {
  entity_kind: EntityKind;
  entity_id: number;
  actor: Actor;
  kind: EventKind;
  prior: Record<string, unknown> | null;
  new: Record<string, unknown>;
  at?: string;
}

/** How long a sitting stays open: a further edit within this of the last one is the same session (ADR-0008). */
export const EDIT_SESSION_MS = 5 * 60_000;

/**
 * An `updated` event is an edit session, not a write (ADR-0008). A field on a
 * view is always live, so a two-minute sitting at a design would otherwise
 * leave dozens of rows each holding a whole document. A further edit of the
 * same entity by the same actor within `EDIT_SESSION_MS` amends the open row
 * instead: `prior` stays what the sitting started from — that is what makes it
 * the unit of recovery — while `new` and `at` advance. Every other kind
 * appends. Coalescing lives here so `goblin` and agents inherit it.
 */
export async function recordEvent(db: Db, input: EventInput): Promise<void> {
  const at = input.at ?? now();
  const open = input.kind === 'updated' ? await openSession(db, input, at) : undefined;
  if (!open) {
    await db.insert(event).values({ ...input, at });
    return;
  }
  await db
    .update(event)
    .set({ prior: { ...input.prior, ...(open.prior ?? {}) }, new: { ...open.new, ...input.new }, at })
    .where(eq(event.id, open.id));
}

/** The sitting this write belongs to, or `undefined` when it starts a new one. */
async function openSession(db: Db, input: EventInput, at: string) {
  const since = new Date(new Date(at).getTime() - EDIT_SESSION_MS).toISOString();
  const rows = await db
    .select()
    .from(event)
    .where(
      and(
        eq(event.entity_kind, input.entity_kind),
        eq(event.entity_id, input.entity_id),
        // the actor is part of the key: a planner's rewrite never folds into yours
        eq(event.actor, input.actor),
        eq(event.kind, 'updated'),
        gte(event.at, since),
      ),
    )
    .orderBy(desc(event.at), desc(event.id))
    .limit(1);
  return rows[0];
}

/** Newest first — by `at`, because an amended session's row is older than its last write (ADR-0008). */
export async function listEvents(db: Db, kind: EntityKind, id: number): Promise<Event[]> {
  const rows = await db
    .select()
    .from(event)
    .where(and(eq(event.entity_kind, kind), eq(event.entity_id, id)))
    .orderBy(desc(event.at), desc(event.id));
  return rows as Event[];
}

/** The subset of `next` whose values differ from `current`, as `{prior, new}`; empty when nothing changed. */
export function diff<T extends Record<string, unknown>>(current: T, next: Partial<T>) {
  const prior: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof T & string)[]) {
    const value = next[key];
    if (value === undefined || value === current[key]) continue;
    prior[key] = current[key] ?? null;
    changed[key] = value;
  }
  return { prior, new: changed, changed: Object.keys(changed).length > 0 };
}
