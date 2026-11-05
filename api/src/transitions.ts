/**
 * The intent endpoints (ADR-0004): `POST /tickets/:key/:name`, one per verb in
 * the transition table. The actor comes from the header and the destination
 * from the table, so a client cannot invent a move. No verb takes a body but
 * `start`, whose optional body asks for a Worktree; with none it is the plain
 * Transition like every other.
 */
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { StartWorktreeBodySchema, defaultWorktreeBranch, lifecycle, ticketKey, worktreeBase, type StartWorktreeBody } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { changedUnderneath, commit, pinnedTicketWrite } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { conflict, notFound } from './problems';
import { app as appTable, type TicketRow } from './schema';
import { readSettings } from './settings';
import { makeWorktree } from './worktree';

export interface TransitionDeps {
  db: Db;
  /** The live ticket the `:key` param addresses, or `undefined`. */
  find: (c: Context) => Promise<TicketRow | undefined>;
  missing: (c: Context) => Response;
  toWire: (row: TicketRow) => Promise<unknown>;
}

/**
 * The Worktree `start` asked for, or the refusal that leaves the Ticket where it
 * is. This runs after the Transition is judged and before it commits, so a Ticket
 * that cannot be started makes no folder, and a Worktree whose commit then fails
 * is adopted by the retry.
 */
async function worktreeFor(c: Context, db: Db, row: TicketRow, body: StartWorktreeBody) {
  const { ticket_prefix, worktree_root } = await readSettings(db);
  const key = ticketKey(ticket_prefix, row.id);
  const [app] = row.app_id === null ? [] : await db.select().from(appTable).where(eq(appTable.id, row.app_id));
  if (!app?.checkout) return conflict(c, `nothing changed — ${app?.name ?? 'its App'} has no Checkout, so ${key} cannot be given a Worktree; record the folder that holds its repository on the App`);
  const made = await makeWorktree({
    checkout: app.checkout,
    branch: body.branch ?? defaultWorktreeBranch({ key, title: row.title, worktree_branch: row.worktree_branch }),
    base: worktreeBase(body.base, app),
    root: worktree_root,
  });
  return made.ok ? { worktree_branch: made.branch, worktree_folder: made.folder } : conflict(c, `nothing changed — no Worktree for ${key}: ${made.reason}`);
}

/**
 * Registered after `/:key/restore` so the un-trash route is never shadowed by
 * `:name` — `restore` is not a transition, it is the opposite of the trash.
 */
export function transitionRoute(r: Hono<ActorEnv>, { db, find, missing, toWire }: TransitionDeps) {
  r.post('/:key/:name', async (c) => {
    const name = c.req.param('name');
    if (!lifecycle.isName(name)) return notFound(c, `no transition named ${name}`);
    // an empty body is no body, which keeps every caller from before Worktrees the Transition it always was
    const asked = name === 'start' && (await c.req.text()).trim() !== '' ? await parseBody(c, StartWorktreeBodySchema) : null;
    const row = await find(c);
    if (!row) return missing(c);
    if (asked && !asked.ok) return asked.response;

    const actor = c.get('actor');
    const judged = lifecycle.judge(row, name, actor);
    if (!judged.ok) return conflict(c, judged.refusal, judged.owner);
    const { edge } = judged;

    const worktree = asked ? await worktreeFor(c, db, row, asked.data) : null;
    if (worktree instanceof Response) return worktree;

    const at = now();
    const historyWrite = await eventWrite(db, {
      entity_kind: 'ticket',
      entity_id: row.id,
      actor,
      kind: 'transitioned',
      prior: { status: edge.from, ...(worktree && { worktree_branch: row.worktree_branch, worktree_folder: row.worktree_folder }) },
      new: { status: edge.to, transition: edge.name, ...worktree },
      at,
    });
    const written = await commit(c, db, [pinnedTicketWrite(db, row, { status: edge.to, ...worktree }, at), historyWrite], {
      rolledBack: 'the transition was rolled back',
      stale: () => changedUnderneath(c, db, row.id, name),
    });
    if (written instanceof Response) return written;
    return c.json(await toWire(written[0] as TicketRow));
  });
}
