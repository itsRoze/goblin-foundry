/**
 * The database seam (ADR-0001). This is the ONLY module that imports the
 * driver. Everything else receives a `Db` and uses Drizzle's async API
 * (`await db.select()…`), never the driver's sync calls, so a later move to
 * `drizzle-orm/durable-sqlite` is a swap inside this file.
 */
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_TICKET_PREFIX, TICKET_PREFIX_KEY } from '@gf/shared';
import * as schema from './schema';
import { defaultDbPath } from './db-path';

export { defaultDbPath };

export type Db = BunSQLiteDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  path: string;
  close(): void;
}

export async function openDb(path: string = defaultDbPath()): Promise<DbHandle> {
  mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, strict: true });
  const db = drizzle(client, { schema });
  await db.run(sql`PRAGMA journal_mode = WAL`);
  await db.run(sql`PRAGMA foreign_keys = ON`);
  await ensureSchema(db);
  return { db, path, close: () => client.close() };
}

/**
 * Local schema management is `drizzle-kit push` (ADR-0001); at open we apply
 * the same schema idempotently so fresh dev and test databases just work.
 * Keep this in step with `schema.ts` — new tables land in both.
 */
async function ensureSchema(db: Db): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS setting (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL
  )`);
  await db
    .insert(schema.setting)
    .values({ key: TICKET_PREFIX_KEY, value: DEFAULT_TICKET_PREFIX })
    .onConflictDoNothing();
}
