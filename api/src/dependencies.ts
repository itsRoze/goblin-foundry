/**
 * Dependency edges and the ready frontier (ADR-0009). An edge is a durable
 * fact — "A blocks B" — that never gates a transition; the enforcement point
 * is `GET /api/frontier`. The only write
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
  type TicketSummary,
} from '@goblin/shared';
import type { Context, Hono as HonoType } from 'hono';
import type { ActorEnv } from './actor';
import { changedWhile, commit } from './commit';
import type { AtomicWrite, Db } from './db';
import { eventWrite, now } from './events';
import { readFilter, ticketWhere } from './filters';
import { labelsByTicket } from './labels';
import { parseBody } from './http';
import { conflict, notFound, unprocessable } from './problems';
import { dependency, ticket as ticketTable, type TicketRow } from './schema';
import { readSettings } from './settings';


/** A blocker in a terminal status is *inert* (ADR-0009's word): finished or abandoned, either way out of the way. */
const INERT: TicketStatus[] = [...TERMINAL_STATUSES];

/** ADR-0001 warns off `IN` lists over 100 params, so an iterative walk goes a batch at a time. */
const BATCH = 100;
export function* batches<T>(items: T[]): Generator<T[]> {
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
  async function edgeHistory(c: Context<ActorEnv>, kind: 'dependency_added' | 'dependency_removed', blocker: number, blocked: number, at: string, p: string): Promise<AtomicWrite[]> {
    const actor = c.get('actor');
    return [
      await eventWrite(db, { entity_kind: 'ticket', entity_id: blocked, actor, kind, prior: null, new: { blocker: ticketKey(p, blocker) }, at }),
      await eventWrite(db, { entity_kind: 'ticket', entity_id: blocker, actor, kind, prior: null, new: { blocked: ticketKey(p, blocked) }, at }),
    ];
  }

  /**
   * An end of the edge was judged live, and must still be when the edge
   * commits (ADR-0010): a write that sets nothing and matches only a ticket
   * out of the trash, so one that went in since fails the batch as `stale`.
   * Nothing else about the ticket is pinned; an edit of its title is no
   * reason to refuse an edge.
   */
  const stillLive = (row: TicketRow, p: string): AtomicWrite => ({
    what: `ticket ${ticketKey(p, row.id)}`,
    statement: db
      .update(ticketTable)
      .set({ title: ticketTable.title })
      .where(and(eq(ticketTable.id, row.id), isNull(ticketTable.trashed_at)))
      .returning({ id: ticketTable.id }),
  });

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
    const written = await commit(
      c,
      db,
      [
        stillLive(blocked, p),
        stillLive(blocker, p),
        { what: 'dependency', statement: db.insert(dependency).values({ blocker_id: blocker.id, blocked_id: blocked.id, created_at: at }).returning({ blocker_id: dependency.blocker_id }) },
        ...(await edgeHistory(c, 'dependency_added', blocker.id, blocked.id, at, p)),
      ],
      { rolledBack: 'the dependency was not added', stale: (what) => changedWhile(c, what, 'the dependency') },
    );
    if (written instanceof Response) return written;
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
    const written = await commit(
      c,
      db,
      [
        stillLive(blocked, p),
        // an edge that is not there to delete is the 404 it always was; the batch finds that out and leaves nothing behind
        { what: 'dependency', statement: db.delete(dependency).where(and(eq(dependency.blocker_id, blockerId), eq(dependency.blocked_id, blocked.id))).returning({ blocker_id: dependency.blocker_id }) },
        ...(await edgeHistory(c, 'dependency_removed', blockerId, blocked.id, now(), p)),
      ],
      { rolledBack: 'the dependency was not removed', stale: (what) => (what === 'dependency' ? gone() : changedWhile(c, what, 'the removal')) },
    );
    if (written instanceof Response) return written;
    return c.json(await toDetail(blocked));
  });
}

/**
 * The ready frontier: what is ready to build (GLOSSARY.md). `ready`, no open
 * blocker, stalest first.
 * It narrows by app, project and text through the board's own parser (issue
 * 06), so every endpoint stays reachable from `goblin`.
 */
export function frontierRoutes(db: Db, toWire: (row: TicketRow, prefix: string, labels: string[]) => TicketSummary) {
  const r = new Hono<ActorEnv>();
  r.get('/', async (c) => {
    const filter = readFilter(c);
    if (filter instanceof Response) return filter;
    // the same parser as the board, minus the one parameter this endpoint has already answered
    if (filter.status) return unprocessable(c, [{ path: ['status'], message: 'the frontier is ready by definition' }]);
    const rows = await db
      .select()
      .from(ticketTable)
      .where(and(isNull(ticketTable.trashed_at), eq(ticketTable.status, 'ready'), ...ticketWhere(filter)))
      .orderBy(asc(ticketTable.updated_at), asc(ticketTable.id));
    const { ticket_prefix } = await readSettings(db);
    const blockers = await openBlockers(db, ticket_prefix);
    const labels = await labelsByTicket(db);
    return c.json(rows.filter((row) => (blockers.get(row.id) ?? []).length === 0).map((row) => toWire(row, ticket_prefix, labels(row.id))));
  });
  return r;
}
