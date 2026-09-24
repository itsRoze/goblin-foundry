import { Hono } from 'hono';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  CreateTicketBodySchema,
  PatchTicketBodySchema,
  UNCREATABLE_STATUSES,
  approveGuard,
  ceilingRefusal,
  defaultCreateStatus,
  guardHold,
  isGuarded,
  parseTicketKey,
  ticketKey,
  type Actor,
  type GuardFields,
  type Ticket,
  type TicketDetail,
  type TicketStatus,
} from '@goblin/shared';
import type { Context } from 'hono';
import type { ActorEnv } from './actor';
import { bulkRoute } from './bulk';
import { implementationLinkRoutes } from './implementation-links';
import type { Db } from './db';
import { dependenciesOf, dependencyRoutes, openBlockers, openBlockersOf } from './dependencies';
import { diff, listEvents, now, recordEvent } from './events';
import { readFilter, ticketWhere } from './filters';
import { parseBody } from './http';
import { resolvePlacement, wouldBreakGuard } from './placement';
import { conflict, notFound, unprocessable, type Issue } from './problems';
import { app as appTable, project as projectTable, ticket as ticketTable, type TicketRow } from './schema';
import { readSettings } from './settings';
import { transitionRoute } from './transitions';

type Parent = typeof appTable | typeof projectTable;

/**
 * The wire ticket carries the canonical key; `trashed_via` is bookkeeping and
 * stays inside. `blocked_by` defaults to none for the reads that do not ask —
 * `/api/trash` has no use for a derived condition on something nobody is
 * working on.
 */
export const toTicket = ({ trashed_via: _, ...row }: TicketRow, prefix: string, blocked_by: string[] = []): Ticket => ({
  ...row,
  key: ticketKey(prefix, row.id),
  blocked_by,
});

/**
 * Why this ticket may not be created at this status (ADR-0003), or `null` when
 * it may: an agent's reach ends at `planning`, the terminal statuses are
 * earned rather than declared, and a ticket born in the working end of the
 * lifecycle must already satisfy the approve guard. Every refusal is on
 * `status`, because the status is what the body asked for that it cannot have.
 */
function creationRefusal(actor: Actor, status: TicketStatus, fields: GuardFields): Issue | null {
  const ceiling = ceilingRefusal(actor, status);
  if (ceiling) return { path: ['status'], message: ceiling };
  if ((UNCREATABLE_STATUSES as readonly TicketStatus[]).includes(status))
    return { path: ['status'], message: `a ticket is never created in ${status} — it is earned, not declared` };
  if (!isGuarded(status)) return null;
  const lacks = approveGuard(fields);
  return lacks.length === 0 ? null : { path: ['status'], message: guardHold(status, lacks) };
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

  /** One live ticket on the wire, with the blockers still standing in its way. */
  async function one(row: TicketRow): Promise<Ticket> {
    const p = await prefix();
    return toTicket(row, p, await openBlockersOf(db, row.id, p));
  }

  /** The single-ticket read: the ticket, plus every edge it has declared in either direction. */
  async function detail(row: TicketRow): Promise<TicketDetail> {
    const p = await prefix();
    return { ...(await one(row)), dependencies: await dependenciesOf(db, row.id, p) };
  }

  /** The board's Filter, in full (issue 06); with none of it given, every live ticket. */
  r.get('/', async (c) => {
    const filter = readFilter(c);
    if (filter instanceof Response) return filter;
    const rows = await db
      .select()
      .from(ticketTable)
      .where(and(isNull(ticketTable.trashed_at), ...ticketWhere(filter)))
      .orderBy(asc(ticketTable.id));
    const p = await prefix();
    // one joined query for the whole list, never one per row
    const blockers = await openBlockers(db, p);
    return c.json(rows.map((row) => toTicket(row, p, blockers.get(row.id) ?? [])));
  });

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateTicketBodySchema);
    if (!body.ok) return body.response;
    const placement = await resolvePlacement(db, { app_id: null, project_id: null }, body.data);
    if (Array.isArray(placement)) return unprocessable(c, placement);
    const actor = c.get('actor');
    const at = now();
    const fields = {
      title: body.data.title,
      description: body.data.description ?? '',
      status: body.data.status ?? defaultCreateStatus(actor),
      simple: body.data.simple ?? false,
      design: null,
      ...placement,
    };
    const refused = creationRefusal(actor, fields.status, fields);
    if (refused) return unprocessable(c, [refused]);
    const [row] = await db.insert(ticketTable).values({ ...fields, created_at: at, updated_at: at }).returning();
    if (!row) throw new Error('insert returned no row');
    await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor, kind: 'created', prior: null, new: fields, at });
    // a ticket one statement old has no edges; `blocked_by` is empty by construction
    return c.json(toTicket(row, await prefix()), 201);
  });

  bulkRoute(r, {
    db,
    prefix,
    toWire: async (rows) => {
      const p = await prefix();
      const blockers = await openBlockers(db, p);
      // a Ticket in the trash is nobody's blocked work (`toTicket`)
      return rows.map((row) => toTicket(row, p, row.trashed_at === null ? (blockers.get(row.id) ?? []) : []));
    },
  });

  r.get('/:key/events', async (c) => {
    const row = await find(c, false);
    return row ? c.json(await listEvents(db, 'ticket', row.id)) : missing(c);
  });

  r.get('/:key', async (c) => {
    const row = await find(c, false);
    return row ? c.json(await detail(row)) : missing(c);
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
    if (!change.changed) return c.json(await one(row));
    const at = now();
    const [updated] = await db.update(ticketTable).set({ ...change.new, updated_at: at }).where(eq(ticketTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'updated', prior: change.prior, new: change.new, at });
    return c.json(await one(updated));
  });

  r.delete('/:key', async (c) => {
    const row = await find(c, false);
    if (!row) {
      const trashed = await find(c, true);
      return trashed ? conflict(c, `ticket ${ticketKey(await prefix(), trashed.id)} is already in the trash`) : missing(c);
    }
    const at = now();
    // edges are left alone: a trashed blocker simply stops blocking, and restoring it re-blocks (ADR-0009)
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
    return c.json(await one(restored));
  });

  implementationLinkRoutes(r, { db, find: (c) => find(c, false), missing });

  dependencyRoutes(r, { db, find: (c) => find(c, false), missing, toDetail: (row) => detail(row) });

  // last: `:name` would otherwise swallow `/:key/restore` and `/:key/dependencies` (ADR-0004)
  transitionRoute(r, { db, find: (c) => find(c, false), missing, toWire: (row) => one(row) });

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
