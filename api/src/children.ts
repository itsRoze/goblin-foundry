/**
 * What happens to the things inside an App or Project when it moves, is
 * trashed or restored (ADR-0007). Small sequential statements, one event per
 * touched row; no `IN` lists, no transactions (ADR-0001).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Actor, EntityKind } from '@goblin/shared';
import type { Db } from './db';
import { recordEvent } from './events';
import { project as projectTable, ticket as ticketTable } from './schema';

/** Who is doing this, when — one timestamp for every row a request touches. */
export interface Ctx {
  db: Db;
  actor: Actor;
  at: string;
}

type ChildTable = typeof projectTable | typeof ticketTable;
type ChildRow = { id: number; trashed_at: string | null; trashed_via: string | null };
const kindOf = (table: ChildTable): EntityKind => (table === projectTable ? 'project' : 'ticket');

/** `app:3` / `project:5` — the parent whose cascade took a row, so that parent's restore revives exactly those. */
export const via = (kind: 'app' | 'project', id: number) => `${kind}:${id}`;

async function detach({ db, actor, at }: Ctx, table: ChildTable, row: ChildRow, field: 'app_id' | 'project_id', prior: number | null, next: number | null) {
  if (prior === next) return;
  await db.update(table).set({ [field]: next, updated_at: at }).where(eq(table.id, row.id));
  await recordEvent(db, { entity_kind: kindOf(table), entity_id: row.id, actor, kind: 'updated', prior: { [field]: prior }, new: { [field]: next }, at });
}

async function trashRow({ db, actor, at }: Ctx, table: ChildTable, row: ChildRow, mark: string) {
  await db.update(table).set({ trashed_at: at, trashed_via: mark, updated_at: at }).where(eq(table.id, row.id));
  await recordEvent(db, { entity_kind: kindOf(table), entity_id: row.id, actor, kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at, trashed_via: mark }, at });
}

async function reviveRow({ db, actor, at }: Ctx, table: ChildTable, row: ChildRow) {
  await db.update(table).set({ trashed_at: null, trashed_via: null, updated_at: at }).where(eq(table.id, row.id));
  await recordEvent(db, {
    entity_kind: kindOf(table),
    entity_id: row.id,
    actor,
    kind: 'restored',
    prior: { trashed_at: row.trashed_at, trashed_via: row.trashed_via },
    new: { trashed_at: null, trashed_via: null },
    at,
  });
}

const liveTicketsOfProject = (db: Db, projectId: number) =>
  db.select().from(ticketTable).where(and(eq(ticketTable.project_id, projectId), isNull(ticketTable.trashed_at)));

/** A ticket in a Project always shares the Project's App: rewrite `app_id` on every live ticket of the project. */
export async function moveTicketsOfProject(ctx: Ctx, projectId: number, appId: number | null) {
  for (const t of await liveTicketsOfProject(ctx.db, projectId)) await detach(ctx, ticketTable, t, 'app_id', t.app_id, appId);
}

/** Trashing a Project lets its tickets go (App kept); with cascade they go into the trash marked as taken by the project. */
export async function releaseTicketsOfProject(ctx: Ctx, projectId: number, cascade: boolean) {
  for (const t of await liveTicketsOfProject(ctx.db, projectId)) {
    if (cascade) await trashRow(ctx, ticketTable, t, via('project', projectId));
    else await detach(ctx, ticketTable, t, 'project_id', projectId, null);
  }
}

/** Trashing an App: its Projects (with their tickets) and its project-less tickets are detached, or — with cascade — trashed as taken by the app. */
export async function releaseChildrenOfApp(ctx: Ctx, appId: number, cascade: boolean) {
  const { db } = ctx;
  const projects = await db.select().from(projectTable).where(and(eq(projectTable.app_id, appId), isNull(projectTable.trashed_at)));
  for (const p of projects) {
    if (cascade) {
      await releaseTicketsOfProject(ctx, p.id, true);
      await trashRow(ctx, projectTable, p, via('app', appId));
    } else {
      await detach(ctx, projectTable, p, 'app_id', appId, null);
      await moveTicketsOfProject(ctx, p.id, null);
    }
  }
  const loose = await db
    .select()
    .from(ticketTable)
    .where(and(eq(ticketTable.app_id, appId), isNull(ticketTable.project_id), isNull(ticketTable.trashed_at)));
  for (const t of loose) {
    if (cascade) await trashRow(ctx, ticketTable, t, via('app', appId));
    else await detach(ctx, ticketTable, t, 'app_id', appId, null);
  }
}

/** Restore revives exactly what the parent's cascade took (`trashed_via`), recursively; nothing else. */
export async function reviveChildren(ctx: Ctx, parent: 'app' | 'project', parentId: number) {
  const mark = via(parent, parentId);
  if (parent === 'app') {
    for (const p of await ctx.db.select().from(projectTable).where(eq(projectTable.trashed_via, mark))) {
      await reviveRow(ctx, projectTable, p);
      await reviveChildren(ctx, 'project', p.id);
    }
  }
  for (const t of await ctx.db.select().from(ticketTable).where(eq(ticketTable.trashed_via, mark))) await reviveRow(ctx, ticketTable, t);
}
