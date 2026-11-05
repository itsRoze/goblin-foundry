import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { EntityKind } from '@goblin/shared';
import { openDb } from '../src/db';
import { createApp, type AppDeps } from '../src/app';

/**
 * In-process API harness: a fresh temp SQLite file per test, the Hono app
 * called through `app.request` — no socket. Every later API test uses this.
 */
export async function makeTestApp(deps: AppDeps = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gf-test-'));
  const handle = await openDb(join(dir, 'foundry.db'));
  const app = createApp(handle.db, deps);
  return {
    app,
    /** The database file, for the one thing that is not a client: `goblin backup` copies the file itself. */
    path: handle.path,
    /** For stubbing rows the API cannot yet write (tickets until issue 03). Read behaviour through the API. */
    db: handle.db,
    /**
     * Failure injection at the storage boundary (ADR-0010; the test-database
     * carve-out in ADR-0001): from now on, a write of that row, or of a
     * history event about it (`'ticket event'`, `'app event'`, …), goes wrong
     * inside SQLite. `fault` aborts the statement, as a full disk would;
     * `vanish` makes it match nothing (`RAISE(IGNORE)`), which is what a row
     * that changed underneath the batch looks like from inside it. It is a
     * trigger in the test database, so no application interface exists for it
     * and the code under test cannot tell it from the real thing. The settings
     * row has no id: `'setting'` fails any write of it.
     */
    failWrites(target: 'ticket' | 'project' | 'app' | 'setting' | `${EntityKind} event`, id: number, how: 'fault' | 'vanish' = 'fault') {
      const n = sql.raw(String(Math.trunc(id)));
      const raise = sql.raw(how === 'fault' ? "RAISE(ABORT, 'injected fault')" : 'RAISE(IGNORE)');
      if (target.endsWith(' event')) {
        const kind = sql.raw(`'${target.slice(0, -' event'.length)}'`);
        handle.db.run(sql`CREATE TRIGGER injected_fault BEFORE INSERT ON event WHEN NEW.entity_kind = ${kind} AND NEW.entity_id = ${n} BEGIN SELECT ${raise}; END`);
      } else if (target === 'setting') handle.db.run(sql`CREATE TRIGGER injected_fault BEFORE UPDATE ON setting BEGIN SELECT ${raise}; END`);
      else handle.db.run(sql`CREATE TRIGGER injected_fault BEFORE UPDATE ON ${sql.raw(target)} WHEN NEW.id = ${n} BEGIN SELECT ${raise}; END`);
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
