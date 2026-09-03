import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    close() {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
