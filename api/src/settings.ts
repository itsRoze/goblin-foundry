import { eq } from 'drizzle-orm';
import { DEFAULT_TICKET_PREFIX, type Settings } from '@gf/shared';
import type { Db } from './db';
import { setting } from './schema';

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(setting).where(eq(setting.key, 'ticket_prefix'));
  return { ticket_prefix: rows[0]?.value ?? DEFAULT_TICKET_PREFIX };
}
