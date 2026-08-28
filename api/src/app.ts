import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';
import { readSettings } from './settings';

const WEB_DIST = join(import.meta.dir, '..', '..', 'web', 'dist');

/** The single Hono app; the API under `/api`, the built GUI at everything else. */
export function createApp(db: Db) {
  const app = new Hono();

  app.get('/api/settings', async (c) => c.json(await readSettings(db)));

  if (existsSync(WEB_DIST)) {
    app.use('/*', serveStatic({ root: WEB_DIST }));
    app.get('/*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
  } else {
    app.get('/', (c) => c.text('GUI not built yet — run `bun run build` (or `bun dev`).', 503));
  }

  return app;
}
