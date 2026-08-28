/**
 * Archive / unarchive / trash / restore for Apps and Projects (CONTEXT.md
 * "Archived" vs "Trashed"). Same rules for both; what differs — what happens to
 * children on trash and restore — is passed in as hooks (ADR-0007).
 */
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Actor, EntityKind } from '@goblin/shared';
import type { ActorEnv } from './actor';
import type { Db } from './db';
import { now, recordEvent } from './events';
import { conflict } from './problems';
import { app as appTable, project as projectTable } from './schema';

type LifecycleTable = typeof appTable | typeof projectTable;
export interface LifecycleRow {
  id: number;
  archived_at: string | null;
  trashed_at: string | null;
  trashed_via: string | null;
}

export interface LifecycleHooks<Row extends LifecycleRow> {
  /** Detach children (default) or trash them too, marked as taken by this parent (`cascade`). */
  onTrash(row: Row, cascade: boolean, actor: Actor, at: string): Promise<void>;
  /** Revive children the cascade took; never re-attach detached ones. */
  onRestore(row: Row, actor: Actor, at: string): Promise<void>;
}

export function lifecycle<Row extends LifecycleRow>(db: Db, table: LifecycleTable, kind: EntityKind, hooks: LifecycleHooks<Row>) {
  async function set(row: Row, patch: Partial<LifecycleRow>, at: string): Promise<Row> {
    const [updated] = await db.update(table).set({ ...patch, updated_at: at }).where(eq(table.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    return updated as unknown as Row;
  }
  const label = (row: Row) => `${kind} ${row.id}`;

  return {
    async archive(c: Context<ActorEnv>, row: Row) {
      if (row.archived_at) return conflict(c, `${label(row)} is already archived`);
      const at = now();
      const updated = await set(row, { archived_at: at }, at);
      await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor: c.get('actor'), kind: 'archived', prior: { archived_at: null }, new: { archived_at: at }, at });
      return updated;
    },
    async unarchive(c: Context<ActorEnv>, row: Row) {
      if (!row.archived_at) return conflict(c, `${label(row)} is not archived`);
      const at = now();
      const updated = await set(row, { archived_at: null }, at);
      await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor: c.get('actor'), kind: 'unarchived', prior: { archived_at: row.archived_at }, new: { archived_at: null }, at });
      return updated;
    },
    async trash(c: Context<ActorEnv>, row: Row, cascade: boolean) {
      const actor = c.get('actor');
      const at = now();
      await hooks.onTrash(row, cascade, actor, at);
      const updated = await set(row, { trashed_at: at, trashed_via: null }, at);
      await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor, kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at, cascade }, at });
      return updated;
    },
    async restore(c: Context<ActorEnv>, row: Row) {
      if (!row.trashed_at) return conflict(c, `${label(row)} is not in the trash`);
      const actor = c.get('actor');
      const at = now();
      const updated = await set(row, { trashed_at: null, trashed_via: null }, at);
      await hooks.onRestore(row, actor, at);
      await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor, kind: 'restored', prior: { trashed_at: row.trashed_at }, new: { trashed_at: null }, at });
      return updated;
    },
  };
}

/** `?cascade=1` on DELETE. */
export const wantsCascade = (c: Context) => c.req.query('cascade') === '1';
/** `?archived=1` on a list. */
export const wantsArchived = (c: Context) => c.req.query('archived') === '1';
