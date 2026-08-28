import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';
import { readSettings } from './settings';

const WEB_DIST = join(import.meta.dir, '..', '..', 'web', 'dist');

/** The single Hono app; the API under `/api`, the built GUI at everything else. */
export function createApp(db: Db, opts: { webDist?: string } = {}) {
  const app = new Hono();

  app.get('/api/settings', async (c) => c.json(await readSettings(db)));

  const webDist = opts.webDist ?? WEB_DIST;
  if (existsSync(webDist)) {
    app.use('/*', serveStatic({ root: webDist }));
    app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));
  } else {
    app.get('/', (c) => c.text('GUI not built yet — run `bun run build` (or `bun dev`).', 503));
  }

  return app;
}
