/**
 * One action on a Selection (issue 03b, ADR-0010): `POST /tickets/bulk` with
 * the explicit set and what to do to it. Every member is judged first — by the
 * same table, guard and membership rules a single Ticket meets — and only a
 * set with nothing against it is written, Tickets and history together, in one
 * atomic batch behind `db.ts`. A transition is still a named intent (ADR-0004);
 * there is no status in this body to set.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { BulkTicketsBodySchema, judgeTransition, parseTicketKey, ticketKey, type Actor, type BulkMoveTarget, type BulkRefusal, type Ticket, type TransitionName } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { AtomicWriteError, atomically, type AtomicWrite, type Db } from './db';
import { diff, eventWrite, now, type EventInput } from './events';
import { parseBody } from './http';
import { resolvePlacement, wouldBreakGuard, type Placement } from './placement';
import { conflict, failed, refusedBatch, unprocessable, type Issue } from './problems';
import { app as appTable, project as projectTable, ticket as ticketTable, type TicketRow } from './schema';


/** ADR-0001: no `IN` list over 100 parameters. */
const IN_LIST_MAX = 100;

/** What one member of the set comes to: the change to write, nothing to do, or the sentence that stops the batch. */
type Verdict =
  | { kind: 'change'; set: Partial<TicketRow>; event: Pick<EventInput, 'kind' | 'prior' | 'new'> }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: string; owner?: string };

/** What a named move target asks of a Ticket, in the body shape a single edit would send (ADR-0007). */
function moveBody(to: BulkMoveTarget): { app_id?: number | null; project_id?: number | null } {
  switch (to.kind) {
    case 'project':
      return { project_id: to.id };
    case 'app':
      return { app_id: to.id, project_id: null };
    case 'no-project':
      return { project_id: null };
    case 'nowhere':
      return { app_id: null, project_id: null };
  }
}

const NOWHERE: Placement = { app_id: null, project_id: null };

export interface BulkDeps {
  db: Db;
  prefix: () => Promise<string>;
  /** The committed rows on the wire, with their open blockers, in the order given. */
  toWire: (rows: TicketRow[]) => Promise<Ticket[]>;
}

/** Registered before the `/:key` routes: `bulk` is not a Ticket key, and must never be read as one. */
export function bulkRoute(r: Hono<ActorEnv>, { db, prefix, toWire }: BulkDeps) {
  async function load(ids: number[]): Promise<Map<number, TicketRow>> {
    const rows = new Map<number, TicketRow>();
    for (let i = 0; i < ids.length; i += IN_LIST_MAX)
      for (const row of await db.select().from(ticketTable).where(inArray(ticketTable.id, ids.slice(i, i + IN_LIST_MAX)))) rows.set(row.id, row);
    return rows;
  }

  function transition(row: TicketRow, name: TransitionName, actor: Actor): Verdict {
    const judged = judgeTransition(row, name, actor);
    if (!judged.ok) return { kind: 'refused', reason: judged.reason, owner: judged.owner };
    const { edge } = judged;
    return { kind: 'change', set: { status: edge.to }, event: { kind: 'transitioned', prior: { status: edge.from }, new: { status: edge.to, transition: edge.name } } };
  }

  /**
   * Where a move lands, decided once for the whole set: three of the four
   * targets put every member in the same place, and only `no-project` reads
   * the member (it keeps each Ticket's App). Either the placement, or what is
   * wrong with the destination — which is a fault in the body, not in a Ticket.
   */
  async function destination(to: BulkMoveTarget): Promise<{ placementOf: (row: TicketRow) => Placement; pins: AtomicWrite[] } | Issue[]> {
    if (to.kind === 'no-project') return { placementOf: (row) => ({ app_id: row.app_id, project_id: null }), pins: [] };
    const fixed = await resolvePlacement(db, NOWHERE, moveBody(to));
    if (Array.isArray(fixed)) return fixed;
    // the destination is judged before the batch and must still be as judged when it commits (ADR-0010): a no-op
    // write that matches only a live, unarchived row — and, for a Project, one still in the App the Tickets adopt —
    // fails the batch as `stale` otherwise. It sets nothing, so it leaves no trace.
    const pins: AtomicWrite[] = [];
    if (to.kind === 'project')
      pins.push({
        what: `project ${to.id}`,
        statement: db
          .update(projectTable)
          .set({ name: projectTable.name })
          .where(and(eq(projectTable.id, to.id), isNull(projectTable.trashed_at), isNull(projectTable.archived_at), fixed.app_id === null ? isNull(projectTable.app_id) : eq(projectTable.app_id, fixed.app_id)))
          .returning({ id: projectTable.id }),
      });
    if (fixed.app_id !== null)
      pins.push({
        what: `app ${fixed.app_id}`,
        statement: db
          .update(appTable)
          .set({ name: appTable.name })
          .where(and(eq(appTable.id, fixed.app_id), isNull(appTable.trashed_at), isNull(appTable.archived_at)))
          .returning({ id: appTable.id }),
      });
    return { placementOf: () => fixed, pins };
  }

  function move(row: TicketRow, placement: Placement): Verdict {
    const broken = wouldBreakGuard(row, { ...row, ...placement }, {});
    if (broken.length > 0) return { kind: 'refused', reason: broken.map((issue) => issue.message).join(' · ') };
    const change = diff(row, placement);
    return change.changed ? { kind: 'change', set: change.new, event: { kind: 'updated', prior: change.prior, new: change.new } } : { kind: 'unchanged' };
  }

  // edges are left alone, as a single trash leaves them (ADR-0009)
  const trash = (at: string): Verdict => ({ kind: 'change', set: { trashed_at: at, trashed_via: null }, event: { kind: 'trashed', prior: { trashed_at: null }, new: { trashed_at: at } } });

  r.post('/bulk', async (c) => {
    const body = await parseBody(c, BulkTicketsBodySchema);
    if (!body.ok) return body.response;
    const { action } = body.data;
    const parsed = body.data.tickets.map(parseTicketKey);
    const unparsed = parsed.flatMap((id, i): Issue[] => (id === null ? [{ path: ['tickets', i], message: 'not a ticket key' }] : []));
    if (unparsed.length > 0) return unprocessable(c, unparsed);
    // a set: the same Ticket named twice — `GF-7` and a bare `7` — is one member
    const ids = [...new Set(parsed as number[])];

    const actor = c.get('actor');
    const at = now();
    const p = await prefix();
    const rows = await load(ids);

    const moving = action.kind === 'move' ? await destination(action.to) : null;
    if (Array.isArray(moving)) return unprocessable(c, moving.map((issue) => ({ path: ['action', 'to'], message: issue.message })));

    const refusals: BulkRefusal[] = [];
    let owner: string | undefined;
    const writes: AtomicWrite[] = [...(moving?.pins ?? [])];
    /** Which member a statement is about, so a write that fails can still name its Ticket. */
    const memberOf = new Map<string, string>();
    for (const id of ids) {
      const key = ticketKey(p, id);
      const row = rows.get(id);
      if (!row || row.trashed_at !== null) {
        refusals.push({ key, reason: `ticket ${key} ${row ? 'is in the trash' : 'not found'}` });
        continue;
      }
      const verdict = action.kind === 'transition' ? transition(row, action.name, actor) : moving ? move(row, moving.placementOf(row)) : trash(at);
      if (verdict.kind === 'refused') {
        refusals.push({ key, reason: verdict.reason });
        owner ??= verdict.owner;
        continue;
      }
      if (verdict.kind === 'unchanged') continue;
      const ticketWrite: AtomicWrite = {
        what: `ticket ${key}`,
        // the row as it was judged: live, in that status, and not written since (a batch never overwrites what it did not read)
        statement: db
          .update(ticketTable)
          .set({ ...verdict.set, updated_at: at })
          .where(and(eq(ticketTable.id, id), eq(ticketTable.updated_at, row.updated_at), eq(ticketTable.status, row.status), isNull(ticketTable.trashed_at)))
          .returning({ id: ticketTable.id }),
      };
      const historyWrite = await eventWrite(db, { entity_kind: 'ticket', entity_id: id, actor, at, ...verdict.event });
      for (const write of [ticketWrite, historyWrite]) memberOf.set(write.what, key);
      writes.push(ticketWrite, historyWrite);
    }
    if (refusals.length > 0) return refusedBatch(c, refusals, owner);

    try {
      await atomically(db, writes);
    } catch (error) {
      if (!(error instanceof AtomicWriteError)) throw error;
      if (error.kind === 'fault') return failed(c, `nothing changed — the batch was rolled back (${error.message})`);
      // something moved between the judging and the commit; say which, in the shape every other refusal has
      const key = memberOf.get(error.what);
      if (key !== undefined) return refusedBatch(c, [{ key, reason: `ticket ${key} changed while the batch was being applied — try again` }]);
      return conflict(c, `nothing changed — ${error.what} changed while the batch was being applied; try again`);
    }

    const after = await load(ids);
    return c.json({ tickets: await toWire(ids.flatMap((id) => after.get(id) ?? [])) });
  });
}
