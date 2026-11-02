import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { DEFAULT_TICKET_PREFIX, PatchSettingsBodySchema, TICKET_PREFIX_KEY, type Settings } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { commit } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { conflict } from './problems';
import { setting } from './schema';

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(setting).where(eq(setting.key, TICKET_PREFIX_KEY));
  return { ticket_prefix: rows[0]?.value ?? DEFAULT_TICKET_PREFIX };
}

/**
 * The installation's own record. Changing the prefix changes every displayed
 * key at once and no ticket number (ADR-0002), so it is one write with one
 * event against the settings pseudo-entity (`setting`, id 0), committed
 * together and pinned to the prefix the save read (ADR-0010).
 */
export function settingsRoutes(db: Db) {
  const r = new Hono<ActorEnv>();

  r.get('/', async (c) => c.json(await readSettings(db)));

  r.patch('/', async (c) => {
    const body = await parseBody(c, PatchSettingsBodySchema);
    if (!body.ok) return body.response;
    const prior = await readSettings(db);
    const next: Settings = { ticket_prefix: body.data.ticket_prefix };
    if (prior.ticket_prefix === next.ticket_prefix) return c.json(prior);
    const written = await commit(
      c,
      db,
      [
        {
          what: 'settings',
          // the row is written at open, so this is an update in practice; a row holding another prefix than the one read is left alone, and the batch is stale
          statement: db
            .insert(setting)
            .values({ key: TICKET_PREFIX_KEY, value: next.ticket_prefix })
            .onConflictDoUpdate({ target: setting.key, set: { value: next.ticket_prefix }, setWhere: eq(setting.value, prior.ticket_prefix) })
            .returning({ key: setting.key }),
        },
        await eventWrite(db, { entity_kind: 'setting', entity_id: 0, actor: c.get('actor'), kind: 'updated', prior, new: next, at: now() }),
      ],
      { rolledBack: 'the settings were not saved', stale: () => conflict(c, 'nothing changed — the settings changed while the save was being applied; try again') },
    );
    if (written instanceof Response) return written;
    return c.json(next);
  });

  return r;
}
