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
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_TICKET_PREFIX } from '@gf/shared';
import * as schema from './schema';

export type Db = BunSQLiteDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  path: string;
  close(): void;
}

/** `GF_DB_PATH` (tests, one-offs) or `~/.goblin-foundry/foundry.db`. */
export function defaultDbPath(env: Record<string, string | undefined> = process.env): string {
  return env.GF_DB_PATH ?? join(homedir(), '.goblin-foundry', 'foundry.db');
}

export async function openDb(path: string = defaultDbPath()): Promise<DbHandle> {
  mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, strict: true });
  client.exec('PRAGMA journal_mode = WAL');
  client.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
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
    .values({ key: 'ticket_prefix', value: DEFAULT_TICKET_PREFIX })
    .onConflictDoNothing();
}
