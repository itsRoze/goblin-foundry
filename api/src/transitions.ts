/**
 * The intent endpoints (ADR-0004): `POST /tickets/:key/:name`, one per verb in
 * the transition table. The actor comes from the header and the destination
 * from the table, so a client cannot invent a move. No verb takes a body but
 * `start`, whose optional body asks for a Worktree; with none it is the plain
 * Transition like every other. Open terminal lives beside them because it shares
 * that body and that Worktree, and it is not one of them: it moves no Status.
 */
import { existsSync } from 'node:fs';
import type { Context, Hono } from 'hono';
import { StartWorktreeBodySchema, defaultWorktreeBranch, lifecycle, noTerminalAt, opensTerminal, ticketKey, worktreeBase, type StartWorktreeBody } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { changedUnderneath, commit, pinnedTicketWrite } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { conflict, notFound } from './problems';
import type { TicketRow } from './schema';
import { readSettings } from './settings';
import { appOfTicket, openTerminal, type TerminalSteps } from './terminal';
import { makeWorktree } from './worktree';

export interface TransitionDeps {
  db: Db;
  /** The live ticket the `:key` param addresses, or `undefined`. */
  find: (c: Context) => Promise<TicketRow | undefined>;
  missing: (c: Context) => Response;
  toWire: (row: TicketRow) => Promise<object>;
  terminals: TerminalSteps;
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
  const app = await appOfTicket(db, row);
  if (!app?.checkout) return conflict(c, `nothing changed — ${app?.name ?? 'its App'} has no Checkout, so ${key} cannot be given a Worktree; record the folder that holds its repository on the App`);
  const made = await makeWorktree({
    checkout: app.checkout,
    branch: body.branch ?? defaultWorktreeBranch({ key, title: row.title, worktree_branch: row.worktree_branch }),
    base: worktreeBase(body.base, app),
    root: worktree_root,
  });
  return made.ok ? { worktree_branch: made.branch, worktree_folder: made.folder } : conflict(c, `nothing changed — no Worktree for ${key}: ${made.reason}`);
}

/** The Worktree a body asks for; an empty body is `null`. */
const askedWorktree = async (c: Context) => ((await c.req.text()).trim() === '' ? null : parseBody(c, StartWorktreeBodySchema));

/**
 * Registered after `/:key/restore` so the un-trash route is never shadowed by
 * `:name` — `restore` is not a transition, it is the opposite of the trash.
 */
export function transitionRoute(r: Hono<ActorEnv>, { db, find, missing, toWire, terminals }: TransitionDeps) {
  r.post('/:key/:name', async (c) => {
    const name = c.req.param('name');
    if (!lifecycle.isName(name)) return notFound(c, `no transition named ${name}`);
    // an empty body is no body, which keeps every caller from before Worktrees the Transition it always was
    const asked = name === 'start' ? await askedWorktree(c) : null;
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
    const moved = written[0] as TicketRow;
    const wire = await toWire(moved);
    return c.json(worktree ? { ...wire, terminal: await openTerminal(db, terminals, moved, worktree.worktree_folder) } : wire);
  });
}

/**
 * Open terminal: back to the Ticket's Worktree, or to one made now for a Ticket
 * an agent started plainly. It changes no Status, and it writes history only when
 * there was no Worktree to return to. Registered ahead of `transitionRoute`, whose
 * `:name` would answer for it.
 */
export function terminalRoute(r: Hono<ActorEnv>, { db, find, missing, toWire, terminals }: TransitionDeps) {
  r.post('/:key/terminal', async (c) => {
    const asked = await askedWorktree(c);
    const row = await find(c);
    if (!row) return missing(c);
    if (asked && !asked.ok) return asked.response;

    const key = ticketKey((await readSettings(db)).ticket_prefix, row.id);
    if (!opensTerminal(row.status)) return conflict(c, noTerminalAt(key, row.status));
    const body = asked?.data ?? {};

    if (row.worktree_folder !== null) {
      // a Ticket has at most one Worktree, and a script told otherwise would `cd` somewhere it did not ask for
      if (body.branch !== undefined && body.branch !== row.worktree_branch) return conflict(c, `nothing changed — ${key} already has its Worktree, on ${row.worktree_branch}`);
      if (!existsSync(row.worktree_folder)) return conflict(c, `nothing opened — the Worktree folder of ${key} no longer exists: ${row.worktree_folder}; git worktree prune, then git worktree add with that folder and ${row.worktree_branch}, brings it back`);
      return c.json({ ...(await toWire(row)), terminal: await openTerminal(db, terminals, row, row.worktree_folder) });
    }

    const worktree = await worktreeFor(c, db, row, body);
    if (worktree instanceof Response) return worktree;
    const at = now();
    const historyWrite = await eventWrite(db, {
      entity_kind: 'ticket',
      entity_id: row.id,
      actor: c.get('actor'),
      kind: 'worktree_recorded',
      prior: { worktree_branch: null, worktree_folder: null },
      new: worktree,
      at,
    });
    const written = await commit(c, db, [pinnedTicketWrite(db, row, worktree, at), historyWrite], {
      rolledBack: 'the Worktree was not recorded',
      stale: () => changedUnderneath(c, db, row.id, 'terminal'),
    });
    if (written instanceof Response) return written;
    const recorded = written[0] as TicketRow;
    return c.json({ ...(await toWire(recorded)), terminal: await openTerminal(db, terminals, recorded, worktree.worktree_folder) });
  });
}
