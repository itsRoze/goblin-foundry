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
    db: handle.db,
    path: handle.path,
    close() {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
