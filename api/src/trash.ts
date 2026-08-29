import { Hono } from 'hono';
import { desc, isNotNull } from 'drizzle-orm';
import type { ActorEnv } from './actor';
import { toApp } from './apps';
import type { Db } from './db';
import { toProject } from './projects';
import { app as appTable, project as projectTable, ticket as ticketTable } from './schema';
import { readSettings } from './settings';
import { toTicket } from './tickets';

/** Everything in the trash, most recently trashed first. */
export function trashRoutes(db: Db) {
  const r = new Hono<ActorEnv>();
  r.get('/', async (c) => {
    const apps = await db.select().from(appTable).where(isNotNull(appTable.trashed_at)).orderBy(desc(appTable.trashed_at), desc(appTable.id));
    const projects = await db.select().from(projectTable).where(isNotNull(projectTable.trashed_at)).orderBy(desc(projectTable.trashed_at), desc(projectTable.id));
    const tickets = await db.select().from(ticketTable).where(isNotNull(ticketTable.trashed_at)).orderBy(desc(ticketTable.trashed_at), desc(ticketTable.id));
    const { ticket_prefix } = await readSettings(db);
    return c.json({
      apps: apps.map(toApp),
      projects: projects.map(toProject),
      tickets: tickets.map((t) => toTicket(t, ticket_prefix)),
    });
  });
  return r;
}
