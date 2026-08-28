/**
 * What happens to the things inside an App or Project when it moves, is
 * trashed or restored (ADR-0007). Small sequential statements, one event per
 * touched row; no `IN` lists, no transactions (ADR-0001).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Actor } from '@goblin/shared';
import type { Db } from './db';
import { recordEvent } from './events';
import { project as projectTable, ticket as ticketTable } from './schema';

type Ctx = { db: Db; actor: Actor; at: string };

export const via = (kind: 'app' | 'project', id: number) => `${kind}:${id}`;

/** A ticket in a Project always shares the Project's App: rewrite `app_id` on every live ticket of the project. */
export async function moveTicketsOfProject({ db, actor, at }: Ctx, projectId: number, appId: number | null) {
  const tickets = await db.select().from(ticketTable).where(and(eq(ticketTable.project_id, projectId), isNull(ticketTable.trashed_at)));
  for (const t of tickets) {
    if (t.app_id === appId) continue;
    await db.update(ticketTable).set({ app_id: appId, updated_at: at }).where(eq(ticketTable.id, t.id));
    await recordEvent(db, { entity_kind: 'ticket', entity_id: t.id, actor, kind: 'updated', prior: { app_id: t.app_id }, new: { app_id: appId }, at });
  }
}

/** Trashing a Project by default lets its tickets go (App kept); with cascade they go into the trash marked as taken by the project. */
export async function releaseTicketsOfProject(ctx: Ctx, projectId: number, cascade: boolean) {
  const { db, actor, at } = ctx;
  const tickets = await db.select().from(ticketTable).where(and(eq(ticketTable.project_id, projectId), isNull(ticketTable.trashed_at)));
  for (const t of tickets) {
    if (cascade) {
      await db.update(ticketTable).set({ trashed_at: at, trashed_via: via('project', projectId), updated_at: at }).where(eq(ticketTable.id, t.id));
      await recordEvent(db, { entity_kind: 'ticket', entity_id: t.id, actor, kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at, via: via('project', projectId) }, at });
    } else {
      await db.update(ticketTable).set({ project_id: null, updated_at: at }).where(eq(ticketTable.id, t.id));
      await recordEvent(db, { entity_kind: 'ticket', entity_id: t.id, actor, kind: 'updated', prior: { project_id: projectId }, new: { project_id: null }, at });
    }
  }
}

/** Trashing an App: its Projects (and their tickets) and its project-less tickets are detached, or — with cascade — trashed as taken by the app. */
export async function releaseChildrenOfApp(ctx: Ctx, appId: number, cascade: boolean) {
  const { db, actor, at } = ctx;
  const projects = await db.select().from(projectTable).where(and(eq(projectTable.app_id, appId), isNull(projectTable.trashed_at)));
  for (const p of projects) {
    if (cascade) {
      await releaseTicketsOfProject(ctx, p.id, true);
      await db.update(projectTable).set({ trashed_at: at, trashed_via: via('app', appId), updated_at: at }).where(eq(projectTable.id, p.id));
      await recordEvent(db, { entity_kind: 'project', entity_id: p.id, actor, kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at, via: via('app', appId) }, at });
    } else {
      await db.update(projectTable).set({ app_id: null, updated_at: at }).where(eq(projectTable.id, p.id));
      await recordEvent(db, { entity_kind: 'project', entity_id: p.id, actor, kind: 'updated', prior: { app_id: appId }, new: { app_id: null }, at });
      await moveTicketsOfProject(ctx, p.id, null);
    }
  }
  const loose = await db
    .select()
    .from(ticketTable)
    .where(and(eq(ticketTable.app_id, appId), isNull(ticketTable.project_id), isNull(ticketTable.trashed_at)));
  for (const t of loose) {
    if (cascade) {
      await db.update(ticketTable).set({ trashed_at: at, trashed_via: via('app', appId), updated_at: at }).where(eq(ticketTable.id, t.id));
      await recordEvent(db, { entity_kind: 'ticket', entity_id: t.id, actor, kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at, via: via('app', appId) }, at });
    } else {
      await db.update(ticketTable).set({ app_id: null, updated_at: at }).where(eq(ticketTable.id, t.id));
      await recordEvent(db, { entity_kind: 'ticket', entity_id: t.id, actor, kind: 'updated', prior: { app_id: appId }, new: { app_id: null }, at });
    }
  }
}

/** Restore revives exactly what the parent's cascade took (`trashed_via`), recursively; nothing else. */
export async function reviveChildren(ctx: Ctx, parent: 'app' | 'project', parentId: number) {
  const { db, actor, at } = ctx;
  const mark = via(parent, parentId);
  if (parent === 'app') {
    const projects = await db.select().from(projectTable).where(eq(projectTable.trashed_via, mark));
    for (const p of projects) {
      await db.update(projectTable).set({ trashed_at: null, trashed_via: null, updated_at: at }).where(eq(projectTable.id, p.id));
      await recordEvent(db, { entity_kind: 'project', entity_id: p.id, actor, kind: 'restored', prior: { trashed_at: p.trashed_at }, new: { trashed_at: null }, at });
      await reviveChildren(ctx, 'project', p.id);
    }
  }
  const tickets = await db.select().from(ticketTable).where(eq(ticketTable.trashed_via, mark));
  for (const t of tickets) {
    await db.update(ticketTable).set({ trashed_at: null, trashed_via: null, updated_at: at }).where(eq(ticketTable.id, t.id));
    await recordEvent(db, { entity_kind: 'ticket', entity_id: t.id, actor, kind: 'restored', prior: { trashed_at: t.trashed_at }, new: { trashed_at: null }, at });
  }
}
