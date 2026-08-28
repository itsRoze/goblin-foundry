/**
 * Archive / unarchive / trash / restore for Apps and Projects (CONTEXT.md
 * "Archived" vs "Trashed"), plus per-entity events and the id lookups every
 * resource route needs. Same rules for both; what differs — what happens to
 * children on trash and restore — is passed in as hooks (ADR-0007).
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import type { EntityKind } from '@goblin/shared';
import type { ActorEnv } from './actor';
import type { Ctx } from './children';
import type { Db } from './db';
import { listEvents, now, recordEvent } from './events';
import { idParam } from './http';
import { conflict, notFound } from './problems';
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
  onTrash(ctx: Ctx, row: Row, cascade: boolean): Promise<void>;
  /** Revive children the cascade took; never re-attach detached ones. May hand back an amended row to answer with. */
  onRestore(ctx: Ctx, row: Row): Promise<Row | void>;
}

export interface LifecycleOptions<Row extends LifecycleRow, Wire> {
  db: Db;
  table: LifecycleTable;
  kind: EntityKind;
  toWire: (row: Row) => Wire;
  hooks: LifecycleHooks<Row>;
}

/** `?cascade=1` on DELETE. */
export const wantsCascade = (c: Context) => c.req.query('cascade') === '1';
/** `?archived=1` on a list. */
export const wantsArchived = (c: Context) => c.req.query('archived') === '1';

export function lifecycleRoutes<Row extends LifecycleRow, Wire>(r: Hono<ActorEnv>, { db, table, kind, toWire, hooks }: LifecycleOptions<Row, Wire>) {
  const label = (row: Row) => `${kind} ${row.id}`;
  const missing = (c: Context) => notFound(c, `${kind} ${c.req.param('id')} not found`);

  /** A trashed thing is invisible except through `/api/trash` — resource routes resolve live rows only. */
  async function findLive(c: Context): Promise<Row | undefined> {
    const id = idParam(c);
    if (id === null) return undefined;
    const rows = await db.select().from(table).where(and(eq(table.id, id), isNull(table.trashed_at)));
    return rows[0] as Row | undefined;
  }
  async function findTrashed(c: Context): Promise<Row | undefined> {
    const id = idParam(c);
    if (id === null) return undefined;
    const rows = await db.select().from(table).where(and(eq(table.id, id), isNotNull(table.trashed_at)));
    return rows[0] as Row | undefined;
  }
  async function set(row: Row, patch: Partial<LifecycleRow>, at: string): Promise<Row> {
    const [updated] = await db.update(table).set({ ...patch, updated_at: at }).where(eq(table.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    return updated as unknown as Row;
  }
  const ctxOf = (c: Context<ActorEnv>, at: string): Ctx => ({ db, actor: c.get('actor'), at });

  r.get('/:id/events', async (c) => {
    const row = await findLive(c);
    return row ? c.json(await listEvents(db, kind, row.id)) : missing(c);
  });

  r.post('/:id/archive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    if (row.archived_at) return conflict(c, `${label(row)} is already archived`);
    const at = now();
    const updated = await set(row, { archived_at: at }, at);
    await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor: c.get('actor'), kind: 'archived', prior: { archived_at: null }, new: { archived_at: at }, at });
    return c.json(toWire(updated));
  });

  r.post('/:id/unarchive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    if (!row.archived_at) return conflict(c, `${label(row)} is not archived`);
    const at = now();
    const updated = await set(row, { archived_at: null }, at);
    await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor: c.get('actor'), kind: 'unarchived', prior: { archived_at: row.archived_at }, new: { archived_at: null }, at });
    return c.json(toWire(updated));
  });

  r.delete('/:id', async (c) => {
    const row = await findLive(c);
    if (!row) {
      const trashed = await findTrashed(c);
      return trashed ? conflict(c, `${label(trashed)} is already in the trash`) : missing(c);
    }
    const at = now();
    const ctx = ctxOf(c, at);
    await hooks.onTrash(ctx, row, wantsCascade(c));
    const updated = await set(row, { trashed_at: at, trashed_via: null }, at);
    await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor: ctx.actor, kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at }, at });
    return c.json(toWire(updated));
  });

  r.post('/:id/restore', async (c) => {
    const row = await findTrashed(c);
    if (!row) {
      const live = await findLive(c);
      return live ? conflict(c, `${label(live)} is not in the trash`) : missing(c);
    }
    const at = now();
    const ctx = ctxOf(c, at);
    const updated = await set(row, { trashed_at: null, trashed_via: null }, at);
    const amended = await hooks.onRestore(ctx, updated);
    await recordEvent(db, { entity_kind: kind, entity_id: row.id, actor: ctx.actor, kind: 'restored', prior: { trashed_at: row.trashed_at }, new: { trashed_at: null }, at });
    return c.json(toWire(amended ?? updated));
  });

  return { findLive, missing };
}
