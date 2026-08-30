import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';
import { actorMiddleware } from './actor';
import { appsRoutes } from './apps';
import { frontierRoutes } from './dependencies';
import { projectsRoutes } from './projects';
import { settingsRoutes } from './settings';
import { ticketsRoutes, toTicket } from './tickets';
import { trashRoutes } from './trash';

const WEB_DIST = join(import.meta.dir, '..', '..', 'web', 'dist');

/** The single Hono app; the API under `/api`, the built GUI at everything else. */
export function createApp(db: Db) {
  const app = new Hono();

  app.use('/api/*', actorMiddleware);
  app.route('/api/settings', settingsRoutes(db));
  app.route('/api/apps', appsRoutes(db));
  app.route('/api/projects', projectsRoutes(db));
  app.route('/api/tickets', ticketsRoutes(db));
  app.route('/api/frontier', frontierRoutes(db, toTicket));
  app.route('/api/trash', trashRoutes(db));

  if (existsSync(WEB_DIST)) {
    app.use('/*', serveStatic({ root: WEB_DIST }));
    app.get('/*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
  } else {
    app.get('/', (c) => c.text('GUI not built yet — run `bun run build` (or `bun dev`).', 503));
  }

  return app;
}
