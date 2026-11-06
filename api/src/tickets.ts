import { Hono } from 'hono';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { diff } from '@goblin/history';
import {
  CreateTicketBodySchema,
  PatchTicketBodySchema,
  UNCREATABLE_STATUSES,
  guardHold,
  archivedAt,
  intentWritten,
  lifecycle,
  parseTicketKey,
  ticketKey,
  type GuardFields,
  type Ticket,
  type TicketDetail,
  type TicketStatus,
  type TicketSummary,
} from '@goblin/shared';
import type { Context } from 'hono';
import type { ActorEnv } from './actor';
import { archiveClock, archivedAtOf } from './archive';
import { bulkRoute } from './bulk';
import { implementationLinkRoutes } from './implementation-links';
import { judgeLabels, labelInserts, labelRoutes, labelsByTicket, labelsOf } from './labels';
import type { Db } from './db';
import { dependenciesOf, dependencyRoutes, openBlockers, openBlockersOf } from './dependencies';
import { changedUnderneath, commit, judgedRefusal, newestId, pinnedTicketWrite } from './commit';
import { eventWrite, listEvents, now } from './events';
import { listOrder, readQuery, ticketWhere } from './filters';
import { parseBody } from './http';
import { resolvePlacement, wouldBreakGuard } from './placement';
import { conflict, notFound, unprocessable, type Issue } from './problems';
import { app as appTable, project as projectTable, ticket as ticketTable, type TicketRow } from './schema';
import { readSettings } from './settings';
import type { TerminalSteps } from './terminal';
import { terminalRoute, transitionRoute } from './transitions';

type Parent = typeof appTable | typeof projectTable;

/**
 * The wire ticket carries the canonical key and its labels; `trashed_via` is
 * bookkeeping and stays inside. `blocked_by` defaults to none for the reads
 * that do not ask — `/api/trash` has no use for a derived condition on
 * something nobody is working on. `archived_at` is derived too (ADR-0015), and
 * defaults the same way: a new, trashed or `ready` ticket is never archived.
 */
export const toTicket = ({ trashed_via: _, ...row }: TicketRow, prefix: string, labels: string[], blocked_by: string[] = [], archived_at: string | null = null): Ticket => ({
  ...row,
  archived_at,
  key: ticketKey(prefix, row.id),
  labels,
  blocked_by,
});

/** A list read's row: the wire ticket less its bodies, with the guard's reading of them in their place. */
export const toSummary = (row: TicketRow, prefix: string, labels: string[], blocked_by: string[] = [], archived_at: string | null = null): TicketSummary => {
  const { description, design, ...summary } = toTicket(row, prefix, labels, blocked_by, archived_at);
  return { ...summary, intent_written: intentWritten({ description, design }) };
};

/**
 * Why this ticket may not be created at this status (ADR-0003), or `null` when
 * it may: the terminal statuses are earned rather than declared, and a ticket
 * born in the working end of the lifecycle must already satisfy the approve
 * guard. Whoever asks, the answer is the same (ADR-0012). Every refusal is on
 * `status`, because the status is what the body asked for that it cannot have.
 */
function creationRefusal(status: TicketStatus, fields: GuardFields): Issue | null {
  if ((UNCREATABLE_STATUSES as readonly TicketStatus[]).includes(status))
    return { path: ['status'], message: `a ticket is never created in ${status} — it is earned, not declared` };
  const lacks = lifecycle.missingAt(status, fields);
  return lacks.length === 0 ? null : { path: ['status'], message: guardHold(status, lacks) };
}

export function ticketsRoutes(db: Db, terminals: TerminalSteps) {
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

  /** One live ticket on the wire, with the blockers still standing in its way and whether it is archived. */
  async function one(row: TicketRow): Promise<Ticket> {
    const p = await prefix();
    return toTicket(row, p, await labelsOf(db, row.id), await openBlockersOf(db, row.id, p), (await archivedAtOf(db, [row])).get(row.id) ?? null);
  }

  /** The single-ticket read: the ticket, plus every edge it has declared in either direction. */
  async function detail(row: TicketRow): Promise<TicketDetail> {
    const p = await prefix();
    return { ...(await one(row)), dependencies: await dependenciesOf(db, row.id, p) };
  }

  /** The board's Filter, in full (issue 06), and `exclude_label`; with none of it given, every live ticket that is not archived. */
  r.get('/', async (c) => {
    const query = readQuery(c);
    if (query instanceof Response) return query;
    // one clock for the whole read, so the rows it keeps and the `archived_at` they carry agree
    const at = Date.now();
    const rows = await db
      .select({ row: ticketTable, clock: archiveClock() })
      .from(ticketTable)
      .where(and(isNull(ticketTable.trashed_at), ...ticketWhere(query, at)))
      .orderBy(...listOrder);
    const p = await prefix();
    // one joined query for the whole list, never one per row
    const blockers = await openBlockers(db, p);
    const labels = await labelsByTicket(db);
    return c.json(rows.map(({ row, clock }) => toSummary(row, p, labels(row.id), blockers.get(row.id) ?? [], archivedAt(row.status, clock, at))));
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
      status: body.data.status ?? 'backlog',
      simple: body.data.simple ?? false,
      design: null,
      ...placement,
    };
    const refused = creationRefusal(fields.status, fields);
    if (refused) return unprocessable(c, [refused]);
    const labels = judgeLabels(body.data.labels ?? []);
    if (!labels.ok) return unprocessable(c, [labels.issue]);
    const born = newestId(ticketTable);
    const written = await commit(
      c,
      db,
      [
        { what: 'ticket', statement: db.insert(ticketTable).values({ ...fields, created_at: at, updated_at: at }).returning() },
        ...labelInserts(db, born, labels.labels),
        await eventWrite(db, { entity_kind: 'ticket', entity_id: born, actor, kind: 'created', prior: null, new: { ...fields, labels: labels.labels }, at }),
      ],
      { rolledBack: 'the ticket was not created' },
    );
    if (written instanceof Response) return written;
    // a ticket one statement old has no edges; `blocked_by` is empty by construction
    return c.json(toTicket(written[0] as TicketRow, await prefix(), labels.labels), 201);
  });

  bulkRoute(r, {
    db,
    prefix,
    toWire: async (rows) => {
      const p = await prefix();
      const blockers = await openBlockers(db, p);
      const labels = await labelsByTicket(db);
      const archived = await archivedAtOf(db, rows);
      // a Ticket in the trash is nobody's blocked work (`toTicket`)
      return rows.map((row) => toTicket(row, p, labels(row.id), row.trashed_at === null ? (blockers.get(row.id) ?? []) : [], row.trashed_at === null ? (archived.get(row.id) ?? null) : null));
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
    // the row is read after the body has arrived, so the guard judges the status the ticket is in now, not the one it
    // was in when the headers came; the address still answers before the body does
    const body = await parseBody(c, PatchTicketBodySchema);
    const row = await find(c, false);
    if (!row) return missing(c);
    if (!body.ok) return body.response;
    const placement = await resolvePlacement(db, row, body.data);
    if (Array.isArray(placement)) return unprocessable(c, placement);
    const { title, description, design, simple } = body.data;
    const next = { ...row, ...(description === undefined ? {} : { description }), ...(design === undefined ? {} : { design }), ...(simple === undefined ? {} : { simple }), ...placement };
    const broken = wouldBreakGuard(row, next, body.data);
    if (broken.length > 0) return unprocessable(c, broken);
    const change = diff(row, { title, description, design, simple, ...placement });
    if (!change.changed) return c.json(await one(row));
    const judgedAway = await judgedRefusal(c, row, body.data, () => changedUnderneath(c, db, row.id, 'the edit'));
    if (judgedAway) return judgedAway;
    const at = now();
    const written = await commit(
      c,
      db,
      [pinnedTicketWrite(db, row, change.new, at), await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'updated', prior: change.prior, new: change.new, at })],
      { rolledBack: 'the edit was rolled back', stale: () => changedUnderneath(c, db, row.id, 'the edit') },
    );
    if (written instanceof Response) return written;
    return c.json(await one(written[0] as TicketRow));
  });

  r.delete('/:key', async (c) => {
    const row = await find(c, false);
    if (!row) {
      const trashed = await find(c, true);
      return trashed ? conflict(c, `ticket ${ticketKey(await prefix(), trashed.id)} is already in the trash`) : missing(c);
    }
    const at = now();
    // edges are left alone: a trashed blocker simply stops blocking, and restoring it re-blocks (ADR-0009)
    const written = await commit(
      c,
      db,
      [pinnedTicketWrite(db, row, { trashed_at: at, trashed_via: null }, at), await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at }, at })],
      { rolledBack: 'the ticket was not trashed', stale: () => changedUnderneath(c, db, row.id, 'trash') },
    );
    if (written instanceof Response) return written;
    return c.json(toTicket(written[0] as TicketRow, await prefix(), await labelsOf(db, row.id)));
  });

  r.post('/:key/restore', async (c) => {
    const row = await find(c, true);
    if (!row) {
      const live = await find(c, false);
      return live ? conflict(c, `ticket ${ticketKey(await prefix(), live.id)} is not in the trash`) : missing(c);
    }
    const actor = c.get('actor');
    const at = now();
    // a live ticket never points into the trash: a parent still in there is dropped on the way back (ADR-0007)
    const appGone = await inTrash(appTable, row.app_id);
    const change = diff(row, {
      app_id: appGone ? null : row.app_id,
      project_id: appGone || (await inTrash(projectTable, row.project_id)) ? null : row.project_id,
    });
    const history = { entity_kind: 'ticket' as const, entity_id: row.id, actor, at };
    const written = await commit(
      c,
      db,
      [
        pinnedTicketWrite(db, row, { trashed_at: null, trashed_via: null, ...change.new }, at),
        await eventWrite(db, { ...history, kind: 'restored', prior: { trashed_at: row.trashed_at }, new: { trashed_at: null } }),
        ...(change.changed ? [await eventWrite(db, { ...history, kind: 'updated', prior: change.prior, new: change.new })] : []),
      ],
      { rolledBack: 'the ticket was not restored', stale: () => changedUnderneath(c, db, row.id, 'restore') },
    );
    if (written instanceof Response) return written;
    return c.json(await one(written[0] as TicketRow));
  });

  /**
   * Back on the board for another month (ADR-0015): an `unarchived` event
   * restarts the clock. There is no `archive` — a Ticket leaves on its own.
   */
  r.post('/:key/unarchive', async (c) => {
    const row = await find(c, false);
    if (!row) return missing(c);
    const archived_at = (await archivedAtOf(db, [row])).get(row.id) ?? null;
    if (archived_at === null) return conflict(c, `ticket ${ticketKey(await prefix(), row.id)} is not archived`);
    const at = now();
    const written = await commit(
      c,
      db,
      [
        pinnedTicketWrite(db, row, {}, at),
        await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'unarchived', prior: { archived_at }, new: { archived_at: null }, at }),
      ],
      { rolledBack: 'the ticket was not unarchived', stale: () => changedUnderneath(c, db, row.id, 'unarchive') },
    );
    if (written instanceof Response) return written;
    return c.json(await one(written[0] as TicketRow));
  });

  implementationLinkRoutes(r, { db, find: (c) => find(c, false), missing });

  labelRoutes(r, { db, find: (c) => find(c, false), missing, toWire: (row) => one(row) });

  dependencyRoutes(r, { db, find: (c) => find(c, false), missing, toDetail: (row) => detail(row) });

  const transitionDeps = { db, find: (c: Context) => find(c, false), missing, toWire: (row: TicketRow) => one(row), terminals };
  terminalRoute(r, transitionDeps);
  // last: `:name` would otherwise swallow `/:key/restore`, `/:key/unarchive`, `/:key/dependencies` and `/:key/terminal` (ADR-0004)
  transitionRoute(r, transitionDeps);

  async function inTrash(table: Parent, id: number | null): Promise<boolean> {
    if (id === null) return false;
    const rows = await db.select({ trashed_at: table.trashed_at }).from(table).where(eq(table.id, id));
    return rows[0]?.trashed_at != null;
  }


  return r;
}
