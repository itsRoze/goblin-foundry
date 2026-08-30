/**
 * Dependency edges and the ready frontier (ADR-0009). An edge is a durable
 * fact — "A blocks B" — that never gates a transition; the enforcement point
 * is `GET /api/frontier`, which a controller (S5) will drain. The only write
 * that is ever refused is one that would close a cycle, because a cycle
 * starves the frontier silently with no actor left to blame.
 */
import { Hono } from 'hono';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import {
  AddDependencyBodySchema,
  TERMINAL_STATUSES,
  parseTicketKey,
  ticketKey,
  type DependencyRef,
  type TicketDependencies,
  type TicketStatus,
} from '@goblin/shared';
import type { Context, Hono as HonoType } from 'hono';
import type { ActorEnv } from './actor';
import type { Db } from './db';
import { now, recordEvent } from './events';
import { parseBody } from './http';
import { conflict, notFound, unprocessable } from './problems';
import { dependency, ticket as ticketTable } from './schema';
import { readSettings } from './settings';

type TicketRow = typeof ticketTable.$inferSelect;

/** A blocker in a terminal status is *inert* (ADR-0009's word): finished or abandoned, either way out of the way. */
const INERT: TicketStatus[] = [...TERMINAL_STATUSES];

/** ADR-0001 warns off `IN` lists over 100 params, so an iterative walk goes a batch at a time. */
const BATCH = 100;
function* batches<T>(items: T[]): Generator<T[]> {
  for (let i = 0; i < items.length; i += BATCH) yield items.slice(i, i + BATCH);
}

/**
 * Every ticket's *open* blockers, by ticket id, in one joined query, so a list
 * read costs one extra statement rather than one per row. A trashed blocker is
 * absent from the map for as long as it is in the trash; restoring it puts it
 * back.
 */
export async function openBlockers(db: Db, prefix: string): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  for (const row of await openEdges(db)) {
    const keys = map.get(row.blocked_id) ?? [];
    keys.push(ticketKey(prefix, row.blocker_id));
    map.set(row.blocked_id, keys);
  }
  return map;
}

/** The same question for one ticket, so a single-ticket read does not sweep the whole edge table. */
export async function openBlockersOf(db: Db, id: number, prefix: string): Promise<string[]> {
  return (await openEdges(db, id)).map((row) => ticketKey(prefix, row.blocker_id));
}

/** Every edge whose blocker is still in the way, blocked ticket first — the one join both readers share. */
function openEdges(db: Db, blocked?: number) {
  const live = and(isNull(ticketTable.trashed_at), notInArray(ticketTable.status, INERT));
  return db
    .select({ blocked_id: dependency.blocked_id, blocker_id: dependency.blocker_id })
    .from(dependency)
    .innerJoin(ticketTable, eq(ticketTable.id, dependency.blocker_id))
    .where(blocked === undefined ? live : and(live, eq(dependency.blocked_id, blocked)))
    .orderBy(asc(dependency.blocked_id), asc(dependency.blocker_id));
}

const refOf = (row: Pick<TicketRow, 'id' | 'title' | 'status' | 'trashed_at'>, prefix: string): DependencyRef => ({
  key: ticketKey(prefix, row.id),
  title: row.title,
  status: row.status,
  trashed: row.trashed_at !== null,
});

/**
 * Both directions of one ticket's edges, satisfied ones included: the chips
 * show what was declared, and the reader tells the inert ones apart by whether
 * the key is in `blocked_by`.
 */
export async function dependenciesOf(db: Db, id: number, prefix: string): Promise<TicketDependencies> {
  type End = typeof dependency.blocked_id | typeof dependency.blocker_id;
  const side = async (mine: End, theirs: End) => {
    const rows = await db
      .select({ id: ticketTable.id, title: ticketTable.title, status: ticketTable.status, trashed_at: ticketTable.trashed_at })
      .from(dependency)
      .innerJoin(ticketTable, eq(ticketTable.id, theirs))
      .where(eq(mine, id))
      .orderBy(asc(ticketTable.id));
    return rows.map((row) => refOf(row, prefix));
  };
  return {
    depends_on: await side(dependency.blocked_id, dependency.blocker_id),
    blocks: await side(dependency.blocker_id, dependency.blocked_id),
  };
}

/**
 * Whether `from` already blocks `target`, directly or through any chain —
 * iterative `select()`s through the db seam, never raw SQL (ADR-0001). The
 * walk ignores statuses on purpose: a cycle that only appeared when a `done`
 * ticket was reopened would surface at a moment nobody is thinking about
 * dependencies (ADR-0009).
 */
async function alreadyBlocks(db: Db, from: number, target: number): Promise<boolean> {
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const batch of batches(frontier)) {
      const rows = await db.select({ blocked_id: dependency.blocked_id }).from(dependency).where(inArray(dependency.blocker_id, batch));
      for (const { blocked_id } of rows) {
        if (blocked_id === target) return true;
        if (seen.has(blocked_id)) continue;
        seen.add(blocked_id);
        next.push(blocked_id);
      }
    }
    frontier = next;
  }
  return false;
}

export interface DependencyDeps {
  db: Db;
  /** The live ticket `:key` addresses, or `undefined` — a trashed one is invisible here as everywhere. */
  find: (c: Context) => Promise<TicketRow | undefined>;
  missing: (c: Context) => Response;
  /** The blocked ticket as the client should see it afterwards, edges and all. */
  toDetail: (row: TicketRow) => Promise<unknown>;
}

/**
 * The intent hangs off the *blocked* ticket (ADR-0004): declaring a dependency
 * is something you do to the thing that has to wait. Registered before the
 * transition route so `:name` never swallows `dependencies`.
 */
export function dependencyRoutes(r: HonoType<ActorEnv>, { db, find, missing, toDetail }: DependencyDeps) {
  const prefix = async () => (await readSettings(db)).ticket_prefix;

  /**
   * The blocker named in the body, or the 422 that says why it is not usable.
   * A `404` would be about the *address*, and the address here is the blocked
   * ticket, which was found: what is wrong is the body, so it is a 422 with an
   * issue on `blocker` like any other unusable field (ADR-0004).
   */
  async function resolveBlocker(c: Context, raw: string, p: string): Promise<TicketRow | Response> {
    const id = parseTicketKey(raw);
    if (id === null) return unprocessable(c, [{ path: ['blocker'], message: `${raw} is not a ticket key` }]);
    const [row] = await db.select().from(ticketTable).where(eq(ticketTable.id, id));
    // a new edge may not touch the trash, though an existing one survives it (ADR-0009)
    if (!row) return unprocessable(c, [{ path: ['blocker'], message: `ticket ${ticketKey(p, id)} not found` }]);
    if (row.trashed_at !== null) return unprocessable(c, [{ path: ['blocker'], message: `ticket ${ticketKey(p, id)} is in the trash` }]);
    return row;
  }

  /** An edge is news to both its ends, so each ticket's history names the other. */
  async function recordEdge(c: Context<ActorEnv>, kind: 'dependency_added' | 'dependency_removed', blocker: number, blocked: number, at: string, p: string) {
    const actor = c.get('actor');
    await recordEvent(db, { entity_kind: 'ticket', entity_id: blocked, actor, kind, prior: null, new: { blocker: ticketKey(p, blocker) }, at });
    await recordEvent(db, { entity_kind: 'ticket', entity_id: blocker, actor, kind, prior: null, new: { blocked: ticketKey(p, blocked) }, at });
  }

  r.post('/:key/dependencies', async (c) => {
    const blocked = await find(c);
    if (!blocked) return missing(c);
    const body = await parseBody(c, AddDependencyBodySchema);
    if (!body.ok) return body.response;
    // one settings read for the whole handler; every key below is built from it
    const p = await prefix();
    const blocker = await resolveBlocker(c, body.data.blocker, p);
    if (blocker instanceof Response) return blocker;

    const keys = { blocker: ticketKey(p, blocker.id), blocked: ticketKey(p, blocked.id) };
    if (blocker.id === blocked.id) return conflict(c, `${keys.blocked} cannot block itself`);

    const existing = await db
      .select({ blocker_id: dependency.blocker_id })
      .from(dependency)
      .where(and(eq(dependency.blocker_id, blocker.id), eq(dependency.blocked_id, blocked.id)));
    // re-declaring an edge is not news; it is the same true fact said twice
    if (existing.length > 0) return c.json(await toDetail(blocked));

    if (await alreadyBlocks(db, blocked.id, blocker.id)) return conflict(c, `${keys.blocker} already waits on ${keys.blocked} — that would be a cycle`);

    const at = now();
    await db.insert(dependency).values({ blocker_id: blocker.id, blocked_id: blocked.id, created_at: at });
    await recordEdge(c, 'dependency_added', blocker.id, blocked.id, at, p);
    return c.json(await toDetail(blocked));
  });

  r.delete('/:key/dependencies/:blockerKey', async (c) => {
    const blocked = await find(c);
    if (!blocked) return missing(c);
    const raw = c.req.param('blockerKey');
    const blockerId = parseTicketKey(raw);
    const p = await prefix();
    const gone = () => notFound(c, `${raw} does not block ${ticketKey(p, blocked.id)}`);
    if (blockerId === null) return gone();
    const removed = await db
      .delete(dependency)
      .where(and(eq(dependency.blocker_id, blockerId), eq(dependency.blocked_id, blocked.id)))
      .returning();
    if (removed.length === 0) return gone();
    await recordEdge(c, 'dependency_removed', blockerId, blocked.id, now(), p);
    return c.json(await toDetail(blocked));
  });
}

/**
 * The ready frontier: what a controller may claim (CONTEXT.md). `ready`, no
 * open blocker, stalest first — the ordering is the only claim order S1 has.
 */
export function frontierRoutes(db: Db, toWire: (row: TicketRow, prefix: string, blocked_by: string[]) => unknown) {
  const r = new Hono<ActorEnv>();
  r.get('/', async (c) => {
    const rows = await db
      .select()
      .from(ticketTable)
      .where(and(isNull(ticketTable.trashed_at), eq(ticketTable.status, 'ready')))
      .orderBy(asc(ticketTable.updated_at), asc(ticketTable.id));
    const { ticket_prefix } = await readSettings(db);
    const blockers = await openBlockers(db, ticket_prefix);
    return c.json(rows.filter((row) => (blockers.get(row.id) ?? []).length === 0).map((row) => toWire(row, ticket_prefix, [])));
  });
  return r;
}
