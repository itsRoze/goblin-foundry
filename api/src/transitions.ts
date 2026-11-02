/**
 * The intent endpoints (ADR-0004): `POST /tickets/:key/:name`, one per verb in
 * the transition table. No body — the actor comes from the header and the
 * destination from the table, so a client cannot invent a move.
 */
import type { Context, Hono } from 'hono';
import { lifecycle } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { changedUnderneath, commit, pinnedTicketWrite } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { conflict, notFound } from './problems';
import type { TicketRow } from './schema';


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
    if (!lifecycle.isName(name)) return notFound(c, `no transition named ${name}`);
    const row = await find(c);
    if (!row) return missing(c);

    const actor = c.get('actor');
    const judged = lifecycle.judge(row, name, actor);
    if (!judged.ok) return conflict(c, judged.refusal, judged.owner);
    const { edge } = judged;

    const at = now();
    const historyWrite = await eventWrite(db, {
      entity_kind: 'ticket',
      entity_id: row.id,
      actor,
      kind: 'transitioned',
      prior: { status: edge.from },
      new: { status: edge.to, transition: edge.name },
      at,
    });
    const written = await commit(c, db, [pinnedTicketWrite(db, row, { status: edge.to }, at), historyWrite], {
      rolledBack: 'the transition was rolled back',
      stale: () => changedUnderneath(c, db, row.id, name),
    });
    if (written instanceof Response) return written;
    return c.json(await toWire(written[0] as TicketRow));
  });
}
