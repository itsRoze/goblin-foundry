/**
 * Archive / unarchive / trash / restore for Apps and Projects (GLOSSARY.md
 * "Archived" vs "Trashed"), plus per-entity events and the id lookups every
 * resource route needs. Same rules for both; what differs — what happens to
 * children on trash and restore — is passed in as hooks (ADR-0007). Each move
 * is one batch of the row, its history and its children's writes, pinned to
 * the rows that were read (ADR-0010).
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import type { ActorEnv } from './actor';
import { ctxOf, type Ctx } from './children';
import { changedWhile, commit, pinnedRowWrite, type LifecycleFields, type LifecycleTable } from './commit';
import type { AtomicWrite, Db } from './db';
import { diff, eventWrite, listEvents, now } from './events';
import { idParam } from './http';
import { conflict, notFound } from './problems';

export interface LifecycleRow extends LifecycleFields {
  id: number;
}

export interface LifecycleHooks<Row extends LifecycleRow> {
  /** Detach children (default) or trash them too, marked as taken by this parent (`cascade`). */
  onTrash(ctx: Ctx, row: Row, cascade: boolean): Promise<AtomicWrite[]>;
  /** Revive children the cascade took; never re-attach detached ones. `rehomed` is what else the row comes back with, as a Project does when its App is still in the trash. */
  onRestore(ctx: Ctx, row: Row): Promise<{ rehomed?: Partial<Row>; children: AtomicWrite[] }>;
}

export interface LifecycleOptions<Row extends LifecycleRow, Wire> {
  db: Db;
  table: LifecycleTable;
  kind: 'app' | 'project';
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
  const pin = (row: Row, set: Partial<LifecycleRow>, at: string) => pinnedRowWrite(db, table, row, set, at, label(row));
  const history = (c: Context<ActorEnv>, row: Row, at: string) => ({ entity_kind: kind, entity_id: row.id, actor: c.get('actor'), at });

  /** The move, committed: the row the batch wrote on the wire, or why nothing changed. */
  async function moved(c: Context, writes: AtomicWrite[], doing: string, notDone: string) {
    const written = await commit(c, db, writes, { rolledBack: `the ${kind} was not ${notDone}`, stale: (what) => changedWhile(c, what, doing) });
    return written instanceof Response ? written : c.json(toWire(written[0] as Row));
  }

  r.get('/:id/events', async (c) => {
    const row = await findLive(c);
    return row ? c.json(await listEvents(db, kind, row.id)) : missing(c);
  });

  r.post('/:id/archive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    if (row.archived_at) return conflict(c, `${label(row)} is already archived`);
    const at = now();
    const writes = [pin(row, { archived_at: at }, at), await eventWrite(db, { ...history(c, row, at), kind: 'archived', prior: { archived_at: null }, new: { archived_at: at } })];
    return moved(c, writes, 'archive', 'archived');
  });

  r.post('/:id/unarchive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    if (!row.archived_at) return conflict(c, `${label(row)} is not archived`);
    const at = now();
    const writes = [pin(row, { archived_at: null }, at), await eventWrite(db, { ...history(c, row, at), kind: 'unarchived', prior: { archived_at: row.archived_at }, new: { archived_at: null } })];
    return moved(c, writes, 'unarchive', 'unarchived');
  });

  r.delete('/:id', async (c) => {
    const row = await findLive(c);
    if (!row) {
      const trashed = await findTrashed(c);
      return trashed ? conflict(c, `${label(trashed)} is already in the trash`) : missing(c);
    }
    const at = now();
    const children = await hooks.onTrash(await ctxOf(db, c, at), row, wantsCascade(c));
    const writes = [pin(row, { trashed_at: at, trashed_via: null }, at), await eventWrite(db, { ...history(c, row, at), kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at } }), ...children];
    return moved(c, writes, 'trash', 'trashed');
  });

  r.post('/:id/restore', async (c) => {
    const row = await findTrashed(c);
    if (!row) {
      const live = await findLive(c);
      return live ? conflict(c, `${label(live)} is not in the trash`) : missing(c);
    }
    const at = now();
    const { rehomed, children } = await hooks.onRestore(await ctxOf(db, c, at), row);
    const change = diff(row, rehomed ?? {});
    const writes = [
      pin(row, { trashed_at: null, trashed_via: null, ...change.new }, at),
      ...(change.changed ? [await eventWrite(db, { ...history(c, row, at), kind: 'updated', prior: change.prior, new: change.new })] : []),
      await eventWrite(db, { ...history(c, row, at), kind: 'restored', prior: { trashed_at: row.trashed_at }, new: { trashed_at: null } }),
      ...children,
    ];
    return moved(c, writes, 'restore', 'restored');
  });

  return { findLive, missing };
}
