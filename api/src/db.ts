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

/**
 * One statement of an atomic batch: a query *built* with the ordinary query
 * builder and never awaited, plus what to call it when it fails. It is held in
 * an object because the builder is a thenable — returned bare from an `async`
 * function it would be run by the promise machinery on its way out, outside
 * any transaction. Every statement must end in `.returning()`: the batch
 * proves each one wrote exactly one row.
 */
export interface AtomicWrite {
  what: string;
  statement: { all(): unknown[] };
}

/**
 * Why a batch did not commit. `stale` is a statement that matched no row —
 * its `WHERE` named a version of the row that is no longer there — and `fault`
 * is the driver refusing a write. Either way nothing was kept.
 */
export class AtomicWriteError extends Error {
  constructor(
    public kind: 'stale' | 'fault',
    /** The failing statement's own `what`, so a caller can say which of its members it was about. */
    public what: string,
    cause?: unknown,
  ) {
    super(`${what}: ${kind === 'stale' ? 'the row changed underneath the batch' : cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/**
 * The atomic boundary ADR-0010 asks for: every statement commits, or none
 * does. Drizzle's `transaction()` is not it — on this driver it is synchronous
 * and commits at an async callback's first `await`, and on durable-sqlite it
 * is broken outright (ADR-0001) — so the batch is a *list*, the shape D1's
 * `batch()` and a Durable Object's `transactionSync()` both honour, and what
 * makes it atomic here stays inside the seam: `BEGIN IMMEDIATE` to `COMMIT`
 * in one synchronous run, with no `await` for another request to slip into.
 * It is `async` only so the signature survives a driver whose batch is.
 *
 * Callers do their reading and deciding first and hand over writes whose
 * `WHERE` pins what they read; a statement that matches no row is `stale`.
 * `api/test/db.test.ts` and `bulk.test.ts` hold the rollback evidence.
 */
export async function atomically(db: Db, writes: readonly AtomicWrite[]): Promise<void> {
  db.run(sql`BEGIN IMMEDIATE`);
  try {
    for (const write of writes) {
      let rows: unknown[];
      try {
        rows = write.statement.all();
      } catch (cause) {
        throw new AtomicWriteError('fault', write.what, cause);
      }
      if (rows.length !== 1) throw new AtomicWriteError('stale', write.what);
    }
    db.run(sql`COMMIT`);
  } catch (error) {
    try {
      db.run(sql`ROLLBACK`);
    } catch {
      // SQLite had already rolled the transaction back itself (a full disk, `RAISE(ROLLBACK)`); there is nothing left to undo
    }
    throw error instanceof AtomicWriteError ? error : new AtomicWriteError('fault', 'commit', error);
  }
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
 * A whole copy of the database at `destination`, taken with `VACUUM INTO` —
 * ADR-0001's second carve-out, and the only place outside `openDb` that
 * touches the driver. Read-only, off the request path, and consistent without
 * stopping the server: SQLite reads through the WAL and writes one settled
 * file, which is what makes a copy safe to take while `bun dev` is running.
 * `goblin backup` calls this rather than importing the driver itself.
 */
export function backupTo(source: string, destination: string): void {
  const client = new Database(source, { readonly: true, strict: true });
  try {
    // the destination is a path, not a table name, so it binds like any value
    client.run('VACUUM INTO ?', [destination]);
  } finally {
    client.close();
  }
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
  db.run(sql`CREATE TABLE IF NOT EXISTS app (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    name text NOT NULL,
    repository_url text,
    default_branch text,
    description text DEFAULT '' NOT NULL,
    archived_at text,
    trashed_at text,
    trashed_via text,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS project (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    app_id integer REFERENCES app(id),
    name text NOT NULL,
    description text DEFAULT '' NOT NULL,
    design text,
    archived_at text,
    trashed_at text,
    trashed_via text,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS ticket (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    title text NOT NULL,
    description text DEFAULT '' NOT NULL,
    status text DEFAULT 'backlog' NOT NULL CHECK (status IN (${schema.statusList()})),
    simple integer DEFAULT false NOT NULL,
    design text,
    app_id integer REFERENCES app(id),
    project_id integer REFERENCES project(id),
    trashed_at text,
    trashed_via text,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS dependency (
    blocker_id integer NOT NULL REFERENCES ticket(id),
    blocked_id integer NOT NULL REFERENCES ticket(id),
    created_at text NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS dependency_blocked ON dependency (blocked_id)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS implementation_link (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    ticket_id integer NOT NULL REFERENCES ticket(id),
    url text NOT NULL,
    created_at text NOT NULL
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS implementation_link_ticket_url ON implementation_link (ticket_id, url)`);
  db.run(sql`CREATE TABLE IF NOT EXISTS event (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    entity_kind text NOT NULL,
    entity_id integer NOT NULL,
    actor text NOT NULL,
    kind text NOT NULL,
    prior text,
    new text NOT NULL,
    at text NOT NULL
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS event_entity ON event (entity_kind, entity_id, id)`);
  await db
    .insert(schema.setting)
    .values({ key: TICKET_PREFIX_KEY, value: DEFAULT_TICKET_PREFIX })
    .onConflictDoNothing();
}
