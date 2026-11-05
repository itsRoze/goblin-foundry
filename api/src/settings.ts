import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { diff } from '@goblin/history';
import { DEFAULT_TERMINAL_STEP, DEFAULT_TICKET_PREFIX, DEFAULT_WORKTREE_ROOT, PatchSettingsBodySchema, TERMINAL_STEP_KEY, TICKET_PREFIX_KEY, TerminalStepSchema, WORKTREE_ROOT_KEY, type Settings } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { commit } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { conflict, unprocessable } from './problems';
import { setting } from './schema';
import type { TerminalSteps } from './terminal';

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(setting);
  const held = (key: string) => rows.find((row) => row.key === key)?.value;
  return {
    ticket_prefix: held(TICKET_PREFIX_KEY) ?? DEFAULT_TICKET_PREFIX,
    worktree_root: held(WORKTREE_ROOT_KEY) ?? DEFAULT_WORKTREE_ROOT,
    terminal_step: TerminalStepSchema.catch(DEFAULT_TERMINAL_STEP).parse(held(TERMINAL_STEP_KEY)),
  };
}

/**
 * The installation's own record. Changing the prefix changes every displayed
 * key at once and no ticket number (ADR-0002). A save is one write per setting
 * it changes and one event against the settings pseudo-entity (`setting`, id
 * 0), committed together and pinned to the values the save read (ADR-0010).
 * The rows are seeded at open (`db.ts`), so the save is an update. A terminal
 * step this build has no implementation of is not a choice it can honour.
 */
export function settingsRoutes(db: Db, terminals: TerminalSteps) {
  const r = new Hono<ActorEnv>();

  r.get('/', async (c) => c.json(await readSettings(db)));

  r.patch('/', async (c) => {
    const body = await parseBody(c, PatchSettingsBodySchema);
    if (!body.ok) return body.response;
    const step = body.data.terminal_step;
    if (step !== undefined && !terminals[step]) return unprocessable(c, [{ path: ['terminal_step'], message: `${step} is not built yet: only ${Object.keys(terminals).join(' or ')} can be chosen` }]);
    const prior = await readSettings(db);
    const change = diff(prior, body.data);
    if (!change.changed) return c.json(prior);
    const next: Settings = { ...prior, ...change.new };
    const written = await commit(
      c,
      db,
      [
        ...(Object.keys(change.new) as (keyof Settings)[]).map((key) => ({
          what: 'settings',
          statement: db
            .update(setting)
            .set({ value: next[key] })
            .where(and(eq(setting.key, key), eq(setting.value, prior[key])))
            .returning({ key: setting.key }),
        })),
        await eventWrite(db, { entity_kind: 'setting', entity_id: 0, actor: c.get('actor'), kind: 'updated', prior: change.prior, new: change.new, at: now() }),
      ],
      { rolledBack: 'the settings were not saved', stale: () => conflict(c, 'nothing changed — the settings changed while the save was being applied; try again') },
    );
    if (written instanceof Response) return written;
    return c.json(next);
  });

  return r;
}
