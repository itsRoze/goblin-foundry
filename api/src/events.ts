import { and, desc, eq } from 'drizzle-orm';
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

export async function recordEvent(db: Db, input: EventInput): Promise<void> {
  await db.insert(event).values({ ...input, at: input.at ?? now() });
}

/** Newest first. */
export async function listEvents(db: Db, kind: EntityKind, id: number): Promise<Event[]> {
  const rows = await db
    .select()
    .from(event)
    .where(and(eq(event.entity_kind, kind), eq(event.entity_id, id)))
    .orderBy(desc(event.id));
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
