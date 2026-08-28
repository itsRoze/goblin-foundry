/**
 * The database seam (ADR-0001). This is the ONLY module that imports the
 * driver. Everything else receives a `Db` and uses Drizzle's thenable query
 * builder (`await db.select()…`), never `db.run`/`db.all` or the driver's own
 * calls, so a later move to `drizzle-orm/durable-sqlite` is a swap inside
 * this file.
 */
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_TICKET_PREFIX, TICKET_PREFIX_KEY } from '@goblin/shared';
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
  // `db.run` is typed synchronous on the bun-sqlite driver (no promise to
  // await); it is used only here, in the seam, for PRAGMAs and DDL. Query
  // code elsewhere uses the thenable query builder (`await db.select()…`).
  db.run(sql`PRAGMA journal_mode = WAL`);
  db.run(sql`PRAGMA foreign_keys = ON`);
  await ensureSchema(db);
  return { db, path, close: () => client.close() };
}

/**
 * Local schema management is `drizzle-kit push` (ADR-0001); at open we apply
 * the same schema idempotently so fresh dev and test databases just work.
 * Keep this in step with `schema.ts` — new tables land in both.
 */
async function ensureSchema(db: Db): Promise<void> {
  db.run(sql`CREATE TABLE IF NOT EXISTS setting (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL
  )`);
  await db
    .insert(schema.setting)
    .values({ key: TICKET_PREFIX_KEY, value: DEFAULT_TICKET_PREFIX })
    .onConflictDoNothing();
}
