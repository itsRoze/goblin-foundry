/**
 * The intent endpoints (ADR-0004): `POST /tickets/:key/:name`, one per verb in
 * the transition table. No body — the actor comes from the header and the
 * destination from the table, so a client cannot invent a move.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { isTransitionName, judgeTransition, ticketKey } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { AtomicWriteError, atomically, type AtomicWrite, type Db } from './db';
import { eventWrite, now } from './events';
import { conflict, failed, notFound } from './problems';
import { ticket as ticketTable, type TicketRow } from './schema';


export interface TransitionDeps {
  db: Db;
  /** The live ticket the `:key` param addresses, or `undefined`. */
  find: (c: Context) => Promise<TicketRow | undefined>;
  missing: (c: Context) => Response;
  prefix: () => Promise<string>;
  toWire: (row: TicketRow) => Promise<unknown>;
}

/**
 * Registered after `/:key/restore` so the un-trash route is never shadowed by
 * `:name` — `restore` is not a transition, it is the opposite of the trash.
 */
export function transitionRoute(r: Hono<ActorEnv>, { db, find, missing, prefix, toWire }: TransitionDeps) {
  r.post('/:key/:name', async (c) => {
    const name = c.req.param('name');
    if (!isTransitionName(name)) return notFound(c, `no transition named ${name}`);
    const row = await find(c);
    if (!row) return missing(c);

    // structure, then authority, then requirements — the order is the shared table's (ADR-0003)
    const actor = c.get('actor');
    const judged = judgeTransition(row, name, actor);
    if (!judged.ok) return conflict(c, judged.reason, judged.owner);
    const { edge } = judged;

    const at = now();
    const ticketWrite: AtomicWrite = {
      what: `ticket ${row.id}`,
      statement: db
        .update(ticketTable)
        .set({ status: edge.to, updated_at: at })
        .where(and(eq(ticketTable.id, row.id), eq(ticketTable.status, row.status), eq(ticketTable.updated_at, row.updated_at), isNull(ticketTable.trashed_at)))
        .returning({ id: ticketTable.id }),
    };
    const historyWrite = await eventWrite(db, {
      entity_kind: 'ticket',
      entity_id: row.id,
      actor,
      kind: 'transitioned',
      prior: { status: edge.from },
      new: { status: edge.to, transition: edge.name },
      at,
    });
    try {
      await atomically(db, [ticketWrite, historyWrite]);
    } catch (error) {
      if (!(error instanceof AtomicWriteError)) throw error;
      if (error.kind === 'fault') return failed(c, `nothing changed — the transition was rolled back (${error.message})`);
      return conflict(c, `nothing changed — ticket ${ticketKey(await prefix(), row.id)} changed while ${name} was being applied; try again`);
    }

    const [updated] = await db.select().from(ticketTable).where(eq(ticketTable.id, row.id));
    if (!updated) throw new Error('transition committed but the ticket is gone');
    return c.json(await toWire(updated));
  });
}
