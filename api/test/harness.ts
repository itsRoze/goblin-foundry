import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { openDb } from '../src/db';
import { createApp } from '../src/app';

/**
 * In-process API harness: a fresh temp SQLite file per test, the Hono app
 * called through `app.request` — no socket. Every later API test uses this.
 */
export async function makeTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'gf-test-'));
  const handle = await openDb(join(dir, 'foundry.db'));
  const app = createApp(handle.db);
  return {
    app,
    /** The database file, for the one thing that is not a client: `goblin backup` copies the file itself. */
    path: handle.path,
    /** For stubbing rows the API cannot yet write (tickets until issue 03). Read behaviour through the API. */
    db: handle.db,
    /**
     * Failure injection at the storage boundary (ADR-0010; the test-database
     * carve-out in ADR-0001): from now on, a write of that ticket's row, of a
     * history event about it, or of that project's row goes wrong inside
     * SQLite. `fault` aborts the statement, as a full disk would; `vanish`
     * makes it match nothing (`RAISE(IGNORE)`), which is what a row that
     * changed underneath the batch looks like from inside it. It is a trigger
     * in the test database, so no application interface exists for it and the
     * code under test cannot tell it from the real thing.
     */
    failWrites(table: 'ticket' | 'event' | 'project', id: number, how: 'fault' | 'vanish' = 'fault') {
      const n = sql.raw(String(Math.trunc(id)));
      const raise = sql.raw(how === 'fault' ? "RAISE(ABORT, 'injected fault')" : 'RAISE(IGNORE)');
      if (table === 'event') handle.db.run(sql`CREATE TRIGGER injected_fault BEFORE INSERT ON event WHEN NEW.entity_kind = 'ticket' AND NEW.entity_id = ${n} BEGIN SELECT ${raise}; END`);
      else handle.db.run(sql`CREATE TRIGGER injected_fault BEFORE UPDATE ON ${sql.raw(table)} WHEN NEW.id = ${n} BEGIN SELECT ${raise}; END`);
    },
    healWrites() {
      handle.db.run(sql`DROP TRIGGER IF EXISTS injected_fault`);
    },
    close() {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
