/**
 * What happens to the things inside an App or Project when it moves, is
 * trashed or restored (ADR-0007), as the writes it comes to: one pinned row
 * write and one event per touched row, handed back for the parent's batch so
 * the whole cascade commits or none of it does (ADR-0010). No `IN` lists
 * (ADR-0001).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { ticketKey, type Actor } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { pinnedRowWrite, pinnedTicketWrite } from './commit';
import type { AtomicWrite, Db } from './db';
import { diff, eventWrite } from './events';
import { project as projectTable, ticket as ticketTable, type TicketRow } from './schema';
import { readSettings } from './settings';

/** Who is doing this, when — one timestamp for every row a request touches — and the prefix its tickets are named by. */
export interface Ctx {
  db: Db;
  actor: Actor;
  at: string;
  prefix: string;
}

export async function ctxOf(db: Db, c: Context<ActorEnv>, at: string): Promise<Ctx> {
  return { db, actor: c.get('actor'), at, prefix: (await readSettings(db)).ticket_prefix };
}

type ProjectRow = typeof projectTable.$inferSelect;
/** A row a cascade touches, with the kind its pin and its history go under. */
type Child = { kind: 'ticket'; row: TicketRow } | { kind: 'project'; row: ProjectRow };
/** What a cascade may set on a child: where it lives, and whether it is in the trash. */
type ChildChange = Partial<Pick<TicketRow, 'app_id' | 'project_id' | 'trashed_at' | 'trashed_via'>>;
/** Whose cascade is being undone, and for a Project the App its tickets come back in: none when that App is still in the trash. */
export type Revived = { kind: 'app'; id: number } | { kind: 'project'; id: number; appId: number | null };

/** `app:3` / `project:5` — the parent whose cascade took a row, so that parent's restore revives exactly those. */
export const via = (kind: 'app' | 'project', id: number) => `${kind}:${id}`;

function pin({ db, at, prefix }: Ctx, child: Child, set: ChildChange): AtomicWrite {
  switch (child.kind) {
    case 'ticket':
      return pinnedTicketWrite(db, child.row, set, at, `ticket ${ticketKey(prefix, child.row.id)}`);
    case 'project':
      return pinnedRowWrite(db, projectTable, child.row, set, at, `project ${child.row.id}`);
  }
}

const history = ({ db, actor, at }: Ctx, child: Child, kind: 'updated' | 'trashed' | 'restored', prior: Record<string, unknown>, next: Record<string, unknown>) =>
  eventWrite(db, { entity_kind: child.kind, entity_id: child.row.id, actor, kind, prior, new: next, at });

/** A child re-homed (`app_id` or `project_id`); nothing when it already lives there. */
async function rehome(ctx: Ctx, child: Child, home: ChildChange): Promise<AtomicWrite[]> {
  const change = diff(child.row, home);
  if (!change.changed) return [];
  return [pin(ctx, child, change.new), await history(ctx, child, 'updated', change.prior, change.new)];
}

async function trashRow(ctx: Ctx, child: Child, mark: string): Promise<AtomicWrite[]> {
  return [pin(ctx, child, { trashed_at: ctx.at, trashed_via: mark }), await history(ctx, child, 'trashed', { trashed_at: null }, { trashed_at: ctx.at, trashed_via: mark })];
}

/** Back out of the trash, and re-homed on the way when its parent comes back somewhere else (ADR-0007). */
async function reviveRow(ctx: Ctx, child: Child, home: ChildChange = {}): Promise<AtomicWrite[]> {
  const change = diff(child.row, home);
  return [
    pin(ctx, child, { trashed_at: null, trashed_via: null, ...change.new }),
    await history(ctx, child, 'restored', { trashed_at: child.row.trashed_at, trashed_via: child.row.trashed_via }, { trashed_at: null, trashed_via: null }),
    ...(change.changed ? [await history(ctx, child, 'updated', change.prior, change.new)] : []),
  ];
}

const liveTicketsOfProject = (db: Db, projectId: number) =>
  db.select().from(ticketTable).where(and(eq(ticketTable.project_id, projectId), isNull(ticketTable.trashed_at)));

const ticket = (row: TicketRow): Child => ({ kind: 'ticket', row });
const project = (row: ProjectRow): Child => ({ kind: 'project', row });

/** A ticket in a Project always shares the Project's App: rewrite `app_id` on every live ticket of the project. */
export async function moveTicketsOfProject(ctx: Ctx, projectId: number, appId: number | null): Promise<AtomicWrite[]> {
  const writes: AtomicWrite[] = [];
  for (const t of await liveTicketsOfProject(ctx.db, projectId)) writes.push(...(await rehome(ctx, ticket(t), { app_id: appId })));
  return writes;
}

/** Trashing a Project lets its tickets go (App kept); with cascade they go into the trash marked as taken by the project. */
export async function releaseTicketsOfProject(ctx: Ctx, projectId: number, cascade: boolean): Promise<AtomicWrite[]> {
  const writes: AtomicWrite[] = [];
  for (const t of await liveTicketsOfProject(ctx.db, projectId))
    writes.push(...(cascade ? await trashRow(ctx, ticket(t), via('project', projectId)) : await rehome(ctx, ticket(t), { project_id: null })));
  return writes;
}

/** Trashing an App: its Projects (with their tickets) and its project-less tickets are detached, or — with cascade — trashed as taken by the app. */
export async function releaseChildrenOfApp(ctx: Ctx, appId: number, cascade: boolean): Promise<AtomicWrite[]> {
  const { db } = ctx;
  const writes: AtomicWrite[] = [];
  const projects = await db.select().from(projectTable).where(and(eq(projectTable.app_id, appId), isNull(projectTable.trashed_at)));
  for (const p of projects) {
    if (cascade) writes.push(...(await releaseTicketsOfProject(ctx, p.id, true)), ...(await trashRow(ctx, project(p), via('app', appId))));
    else writes.push(...(await rehome(ctx, project(p), { app_id: null })), ...(await moveTicketsOfProject(ctx, p.id, null)));
  }
  const loose = await db
    .select()
    .from(ticketTable)
    .where(and(eq(ticketTable.app_id, appId), isNull(ticketTable.project_id), isNull(ticketTable.trashed_at)));
  for (const t of loose) writes.push(...(cascade ? await trashRow(ctx, ticket(t), via('app', appId)) : await rehome(ctx, ticket(t), { app_id: null })));
  return writes;
}

/**
 * Restore revives exactly what the parent's cascade took (`trashed_via`),
 * recursively; nothing else. A Project's tickets follow it to the App it
 * comes back in (ADR-0007).
 */
export async function reviveChildren(ctx: Ctx, parent: Revived): Promise<AtomicWrite[]> {
  const mark = via(parent.kind, parent.id);
  const writes: AtomicWrite[] = [];
  if (parent.kind === 'app') {
    for (const p of await ctx.db.select().from(projectTable).where(eq(projectTable.trashed_via, mark)))
      writes.push(...(await reviveRow(ctx, project(p))), ...(await reviveChildren(ctx, { kind: 'project', id: p.id, appId: p.app_id })));
  }
  for (const t of await ctx.db.select().from(ticketTable).where(eq(ticketTable.trashed_via, mark)))
    writes.push(...(await reviveRow(ctx, ticket(t), parent.kind === 'project' ? { app_id: parent.appId } : {})));
  return writes;
}
