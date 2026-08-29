import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { DEFAULT_TICKET_PREFIX, PatchSettingsBodySchema, TICKET_PREFIX_KEY, type Settings } from '@goblin/shared';
import type { ActorEnv } from './actor';
import type { Db } from './db';
import { now, recordEvent } from './events';
import { parseBody } from './http';
import { setting } from './schema';

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(setting).where(eq(setting.key, TICKET_PREFIX_KEY));
  return { ticket_prefix: rows[0]?.value ?? DEFAULT_TICKET_PREFIX };
}

/**
 * The installation's own record. Changing the prefix changes every displayed
 * key at once and no ticket number (ADR-0002), so it is one write with one
 * event against the settings pseudo-entity (`setting`, id 0).
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
    await db
      .insert(setting)
      .values({ key: TICKET_PREFIX_KEY, value: next.ticket_prefix })
      .onConflictDoUpdate({ target: setting.key, set: { value: next.ticket_prefix } });
    await recordEvent(db, { entity_kind: 'setting', entity_id: 0, actor: c.get('actor'), kind: 'updated', prior, new: next, at: now() });
    return c.json(next);
  });

  return r;
}
