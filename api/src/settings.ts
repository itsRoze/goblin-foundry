import { eq } from 'drizzle-orm';
import { DEFAULT_TICKET_PREFIX, TICKET_PREFIX_KEY, type Settings } from '@goblin/shared';
import type { Db } from './db';
import { setting } from './schema';

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(setting).where(eq(setting.key, TICKET_PREFIX_KEY));
  return { ticket_prefix: rows[0]?.value ?? DEFAULT_TICKET_PREFIX };
}
