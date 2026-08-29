/**
 * The intent endpoints (ADR-0004): `POST /tickets/:key/:name`, one per verb in
 * the transition table. No body — the actor comes from the header and the
 * destination from the table, so a client cannot invent a move.
 */
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { approveGuard, destinationOf, findTransition, guardRefusal, isTransitionName, structuralRefusal } from '@goblin/shared';
import type { ActorEnv } from './actor';
import type { Db } from './db';
import { now, recordEvent } from './events';
import { conflict, notFound } from './problems';
import { ticket as ticketTable } from './schema';

type TicketRow = typeof ticketTable.$inferSelect;

export interface TransitionDeps {
  db: Db;
  /** The live ticket the `:key` param addresses, or `undefined`. */
  find: (c: Context) => Promise<TicketRow | undefined>;
  missing: (c: Context) => Response;
  toWire: (row: TicketRow) => Promise<unknown>;
}

/**
 * Registered after `/:key/restore` so the un-trash route is never shadowed by
 * `:name` — `restore` is not a transition, it is the opposite of the trash.
 */
export function transitionRoute(r: Hono<ActorEnv>, { db, find, missing, toWire }: TransitionDeps) {
  r.post('/:key/:name', async (c) => {
    const name = c.req.param('name');
    if (!isTransitionName(name)) return notFound(c, `no transition named ${name}`);
    const row = await find(c);
    if (!row) return missing(c);

    const edge = findTransition(row.status, name);
    if (!edge) return conflict(c, structuralRefusal(row.status, destinationOf(name)));

    const lacks = edge.guard ? approveGuard(row) : [];
    if (lacks.length > 0) return conflict(c, guardRefusal(name, lacks), edge.owner);

    const at = now();
    const [updated] = await db.update(ticketTable).set({ status: edge.to, updated_at: at }).where(eq(ticketTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, {
      entity_kind: 'ticket',
      entity_id: row.id,
      actor: c.get('actor'),
      kind: 'transitioned',
      prior: { status: edge.from },
      new: { status: edge.to, transition: edge.name },
      at,
    });
    return c.json(await toWire(updated));
  });
}
