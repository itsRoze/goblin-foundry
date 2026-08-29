import { Hono } from 'hono';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  CreateTicketBodySchema,
  PatchTicketBodySchema,
  UNCREATABLE_STATUSES,
  approveGuard,
  guardHold,
  isGuarded,
  parseTicketKey,
  ticketKey,
  type ApproveRequirement,
  type GuardFields,
  type Ticket,
  type TicketStatus,
} from '@goblin/shared';
import type { Context } from 'hono';
import type { ActorEnv } from './actor';
import type { Db } from './db';
import { diff, listEvents, now, recordEvent } from './events';
import { parseBody } from './http';
import { conflict, notFound, unprocessable, type Issue } from './problems';
import { app as appTable, project as projectTable, ticket as ticketTable } from './schema';
import { readSettings } from './settings';
import { transitionRoute } from './transitions';

type TicketRow = typeof ticketTable.$inferSelect;

/** The wire ticket carries the canonical key; `trashed_via` is bookkeeping and stays inside. */
export const toTicket = ({ trashed_via: _, ...row }: TicketRow, prefix: string): Ticket => ({ ...row, key: ticketKey(prefix, row.id) });

/** Where a ticket lives. `app_id` is stored as well as `project_id` so the board's commonest filter needs no join (ADR-0007). */
interface Placement {
  app_id: number | null;
  project_id: number | null;
}

type Parent = typeof appTable | typeof projectTable;
const loadApp = async (db: Db, id: number) => (await db.select().from(appTable).where(eq(appTable.id, id)))[0];
const loadProject = async (db: Db, id: number) => (await db.select().from(projectTable).where(eq(projectTable.id, id)))[0];

/** A trashed or archived App or Project is not somewhere a live ticket may point; each refusal says which it is. */
function unavailable(kind: 'app' | 'project', id: number, row: { trashed_at: string | null; archived_at: string | null } | undefined): Issue | null {
  const message = !row ? 'not found' : row.trashed_at ? 'is in the trash' : row.archived_at ? 'is archived' : null;
  return message === null ? null : { path: [`${kind}_id`], message: `${kind} ${id} ${message}` };
}

/**
 * ADR-0007 in one place, for create and patch alike: picking a Project sets
 * the App, a contradicting `app_id` in the same body is refused, and moving
 * the App away from the Project's App drops the Project.
 */
async function resolvePlacement(db: Db, current: Placement, body: { app_id?: number | null; project_id?: number | null }): Promise<Placement | Issue[]> {
  if (body.project_id !== undefined && body.project_id !== null) {
    const project = await loadProject(db, body.project_id);
    const issue = unavailable('project', body.project_id, project);
    if (issue || !project) return [issue ?? { path: ['project_id'], message: `project ${body.project_id} not found` }];
    if (body.app_id !== undefined && body.app_id !== project.app_id)
      return [{ path: ['app_id'], message: `project ${project.id} belongs to ${project.app_id === null ? 'no app' : `app ${project.app_id}`}` }];
    return { app_id: project.app_id, project_id: project.id };
  }

  const project_id = body.project_id === null ? null : current.project_id;
  if (body.app_id === undefined) return { app_id: current.app_id, project_id };
  if (body.app_id !== null) {
    const issue = unavailable('app', body.app_id, await loadApp(db, body.app_id));
    if (issue) return [issue];
  }
  if (project_id === null) return { app_id: body.app_id, project_id };
  const project = await loadProject(db, project_id);
  return { app_id: body.app_id, project_id: project?.app_id === body.app_id ? project_id : null };
}

/**
 * The guard at creation (ADR-0003): the terminal statuses are earned rather
 * than declared, and a ticket born in the working end of the lifecycle must
 * already satisfy the approve guard. Both refusals are on `status`, because
 * the status is what the body asked for that it cannot have.
 */
function bornAt(status: TicketStatus, fields: GuardFields): Issue | null {
  if ((UNCREATABLE_STATUSES as readonly TicketStatus[]).includes(status))
    return { path: ['status'], message: `a ticket is never created in ${status} — it is earned, not declared` };
  if (!isGuarded(status)) return null;
  const lacks = approveGuard(fields);
  return lacks.length === 0 ? null : { path: ['status'], message: guardHold(status, lacks) };
}

/** Which field a missing requirement is the fault of, so the 422 points somewhere the GUI can highlight. */
const BLAMED: Record<ApproveRequirement, 'app_id' | 'design'> = { app: 'app_id', design: 'design' };

/**
 * A ticket at `ready` or beyond must go on satisfying the guard, so an edit
 * that would break it is refused rather than silently dropping the ticket out
 * of the frontier (ADR-0003). Only newly missing requirements count: a patch
 * is never blamed for something that was already absent.
 */
function wouldBreakGuard(row: TicketRow, next: GuardFields, body: { simple?: boolean }): Issue[] {
  if (!isGuarded(row.status)) return [];
  const before = new Set(approveGuard(row));
  return approveGuard(next)
    .filter((requirement) => !before.has(requirement))
    .map((requirement) => ({
      // un-flagging `simple` is what took the design away, so that is the field to name
      path: [requirement === 'design' && body.simple === false ? 'simple' : BLAMED[requirement]],
      message: `${guardHold(row.status, [requirement])} — unapprove it first`,
    }));
}

export function ticketsRoutes(db: Db) {
  const r = new Hono<ActorEnv>();
  const prefix = async () => (await readSettings(db)).ticket_prefix;
  const missing = (c: Context) => notFound(c, `ticket ${c.req.param('key')} not found`);

  /** `GF-7`, a stale `SR-7` and a bare `7` all resolve; a trashed ticket is invisible except through `/api/trash`. */
  async function find(c: Context, trashed: boolean): Promise<TicketRow | undefined> {
    const id = parseTicketKey(c.req.param('key') ?? '');
    if (id === null) return undefined;
    const rows = await db
      .select()
      .from(ticketTable)
      .where(and(eq(ticketTable.id, id), trashed ? isNotNull(ticketTable.trashed_at) : isNull(ticketTable.trashed_at)));
    return rows[0];
  }

  r.get('/', async (c) => {
    const filters = [isNull(ticketTable.trashed_at)];
    for (const [name, column] of [
      ['app_id', ticketTable.app_id],
      ['project_id', ticketTable.project_id],
    ] as const) {
      const raw = c.req.query(name);
      if (raw === undefined) continue;
      if (raw === 'null') filters.push(isNull(column));
      else if (Number.isInteger(Number(raw))) filters.push(eq(column, Number(raw)));
      else return unprocessable(c, [{ path: [name], message: `expected an id or null` }]);
    }
    const rows = await db.select().from(ticketTable).where(and(...filters)).orderBy(asc(ticketTable.id));
    const p = await prefix();
    return c.json(rows.map((row) => toTicket(row, p)));
  });

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateTicketBodySchema);
    if (!body.ok) return body.response;
    const placement = await resolvePlacement(db, { app_id: null, project_id: null }, body.data);
    if (Array.isArray(placement)) return unprocessable(c, placement);
    const at = now();
    const fields = {
      title: body.data.title,
      description: body.data.description ?? '',
      status: body.data.status ?? ('backlog' as const),
      simple: body.data.simple ?? false,
      design: null,
      ...placement,
    };
    const born = bornAt(fields.status, fields);
    if (born) return unprocessable(c, [born]);
    const [row] = await db.insert(ticketTable).values({ ...fields, created_at: at, updated_at: at }).returning();
    if (!row) throw new Error('insert returned no row');
    await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'created', prior: null, new: fields, at });
    return c.json(toTicket(row, await prefix()), 201);
  });

  r.get('/:key/events', async (c) => {
    const row = await find(c, false);
    return row ? c.json(await listEvents(db, 'ticket', row.id)) : missing(c);
  });

  r.get('/:key', async (c) => {
    const row = await find(c, false);
    return row ? c.json(toTicket(row, await prefix())) : missing(c);
  });

  r.patch('/:key', async (c) => {
    const row = await find(c, false);
    if (!row) return missing(c);
    const body = await parseBody(c, PatchTicketBodySchema);
    if (!body.ok) return body.response;
    const placement = await resolvePlacement(db, row, body.data);
    if (Array.isArray(placement)) return unprocessable(c, placement);
    const { title, description, design, simple } = body.data;
    const next = { ...row, ...(design === undefined ? {} : { design }), ...(simple === undefined ? {} : { simple }), ...placement };
    const broken = wouldBreakGuard(row, next, body.data);
    if (broken.length > 0) return unprocessable(c, broken);
    const change = diff(row, { title, description, design, simple, ...placement });
    if (!change.changed) return c.json(toTicket(row, await prefix()));
    const at = now();
    const [updated] = await db.update(ticketTable).set({ ...change.new, updated_at: at }).where(eq(ticketTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'updated', prior: change.prior, new: change.new, at });
    return c.json(toTicket(updated, await prefix()));
  });

  r.delete('/:key', async (c) => {
    const row = await find(c, false);
    if (!row) {
      const trashed = await find(c, true);
      return trashed ? conflict(c, `ticket ${ticketKey(await prefix(), trashed.id)} is already in the trash`) : missing(c);
    }
    const at = now();
    // Dependencies pointing at a trashed ticket are detached here from issue 05; there are none yet.
    const [updated] = await db.update(ticketTable).set({ trashed_at: at, trashed_via: null, updated_at: at }).where(eq(ticketTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at }, at });
    return c.json(toTicket(updated, await prefix()));
  });

  r.post('/:key/restore', async (c) => {
    const row = await find(c, true);
    if (!row) {
      const live = await find(c, false);
      return live ? conflict(c, `ticket ${ticketKey(await prefix(), live.id)} is not in the trash`) : missing(c);
    }
    const actor = c.get('actor');
    const at = now();
    let restored = await set(row.id, { trashed_at: null, trashed_via: null }, at);
    await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor, kind: 'restored', prior: { trashed_at: row.trashed_at }, new: { trashed_at: null }, at });
    // a live ticket never points into the trash: a parent still in there is dropped on the way back (ADR-0007)
    const appGone = await inTrash(appTable, restored.app_id);
    const change = diff(restored, {
      app_id: appGone ? null : restored.app_id,
      project_id: appGone || (await inTrash(projectTable, restored.project_id)) ? null : restored.project_id,
    });
    if (change.changed) {
      restored = await set(row.id, change.new, at);
      await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor, kind: 'updated', prior: change.prior, new: change.new, at });
    }
    return c.json(toTicket(restored, await prefix()));
  });

  // last: `:name` would otherwise swallow `/:key/restore` (ADR-0004)
  transitionRoute(r, { db, find: (c) => find(c, false), missing, toWire: async (row) => toTicket(row, await prefix()) });

  async function inTrash(table: Parent, id: number | null): Promise<boolean> {
    if (id === null) return false;
    const rows = await db.select({ trashed_at: table.trashed_at }).from(table).where(eq(table.id, id));
    return rows[0]?.trashed_at != null;
  }

  async function set(id: number, patch: Partial<TicketRow>, at: string): Promise<TicketRow> {
    const [updated] = await db.update(ticketTable).set({ ...patch, updated_at: at }).where(eq(ticketTable.id, id)).returning();
    if (!updated) throw new Error('update returned no row');
    return updated;
  }

  return r;
}
