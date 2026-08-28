import { Hono, type Context } from 'hono';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { CreateProjectBodySchema, PatchProjectBodySchema, type Project } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { moveTicketsOfProject, releaseTicketsOfProject, reviveChildren } from './children';
import type { Db } from './db';
import { diff, listEvents, now, recordEvent } from './events';
import { idParam, parseBody } from './http';
import { lifecycle, wantsArchived, wantsCascade } from './lifecycle';
import { conflict, notFound, unprocessable } from './problems';
import { app as appTable, project as projectTable } from './schema';

type ProjectRow = typeof projectTable.$inferSelect;
/** `design` is issue 07's; it stays off the wire until then. */
export const toProject = ({ trashed_via: _, design: __, ...row }: ProjectRow): Project => row;

export function projectsRoutes(db: Db) {
  const r = new Hono<ActorEnv>();
  const intents = lifecycle<ProjectRow>(db, projectTable, 'project', {
    onTrash: (row, cascade, actor, at) => releaseTicketsOfProject({ db, actor, at }, row.id, cascade),
    onRestore: (row, actor, at) => reviveChildren({ db, actor, at }, 'project', row.id),
  });

  async function findLive(c: Context): Promise<ProjectRow | undefined> {
    const id = idParam(c);
    if (id === null) return undefined;
    const rows = await db.select().from(projectTable).where(and(eq(projectTable.id, id), isNull(projectTable.trashed_at)));
    return rows[0];
  }
  async function findTrashed(id: number | null): Promise<ProjectRow | undefined> {
    if (id === null) return undefined;
    const rows = await db.select().from(projectTable).where(eq(projectTable.id, id));
    return rows[0]?.trashed_at ? rows[0] : undefined;
  }
  const missing = (c: Context) => notFound(c, `project ${c.req.param('id')} not found`);

  /** A project's app must be a live app (archived is fine: archiving is about navigation). */
  async function appIssue(appId: number | null | undefined) {
    if (appId === null || appId === undefined) return null;
    const rows = await db.select({ trashed_at: appTable.trashed_at }).from(appTable).where(eq(appTable.id, appId));
    const row = rows[0];
    return row && !row.trashed_at ? null : { path: ['app_id'], message: `app ${appId} not found` };
  }

  r.get('/', async (c) => {
    const filters = [isNull(projectTable.trashed_at)];
    if (!wantsArchived(c)) filters.push(isNull(projectTable.archived_at));
    const appParam = c.req.query('app_id');
    if (appParam === 'null') filters.push(isNull(projectTable.app_id));
    else if (appParam !== undefined) {
      const appId = Number(appParam);
      if (!Number.isInteger(appId)) return unprocessable(c, [{ path: ['app_id'], message: 'expected an app id or null' }]);
      filters.push(eq(projectTable.app_id, appId));
    }
    const rows = await db.select().from(projectTable).where(and(...filters)).orderBy(asc(projectTable.id));
    return c.json(rows.map(toProject));
  });

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateProjectBodySchema);
    if (!body.ok) return body.response;
    const issue = await appIssue(body.data.app_id);
    if (issue) return unprocessable(c, [issue]);
    const at = now();
    const fields = { name: body.data.name, description: body.data.description ?? '', app_id: body.data.app_id ?? null };
    const [row] = await db.insert(projectTable).values({ ...fields, created_at: at, updated_at: at }).returning();
    if (!row) throw new Error('insert returned no row');
    await recordEvent(db, { entity_kind: 'project', entity_id: row.id, actor: c.get('actor'), kind: 'created', prior: null, new: fields, at });
    return c.json(toProject(row), 201);
  });

  r.get('/:id', async (c) => {
    const row = await findLive(c);
    return row ? c.json(toProject(row)) : missing(c);
  });

  r.patch('/:id', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    const body = await parseBody(c, PatchProjectBodySchema);
    if (!body.ok) return body.response;
    const change = diff(row, body.data);
    if (!change.changed) return c.json(toProject(row));
    if ('app_id' in change.new) {
      const issue = await appIssue(change.new.app_id as number | null);
      if (issue) return unprocessable(c, [issue]);
    }
    const actor = c.get('actor');
    const at = now();
    const [updated] = await db.update(projectTable).set({ ...change.new, updated_at: at }).where(eq(projectTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, { entity_kind: 'project', entity_id: row.id, actor, kind: 'updated', prior: change.prior, new: change.new, at });
    // moving a project carries its tickets (ADR-0007)
    if ('app_id' in change.new) await moveTicketsOfProject({ db, actor, at }, row.id, updated.app_id);
    return c.json(toProject(updated));
  });

  r.get('/:id/events', async (c) => {
    const row = await findLive(c);
    return row ? c.json(await listEvents(db, 'project', row.id)) : missing(c);
  });

  r.post('/:id/archive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    const result = await intents.archive(c, row);
    return result instanceof Response ? result : c.json(toProject(result));
  });

  r.post('/:id/unarchive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    const result = await intents.unarchive(c, row);
    return result instanceof Response ? result : c.json(toProject(result));
  });

  r.delete('/:id', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    return c.json(toProject(await intents.trash(c, row, wantsCascade(c))));
  });

  r.post('/:id/restore', async (c) => {
    const row = await findTrashed(idParam(c));
    if (!row) {
      const live = await findLive(c);
      return live ? conflict(c, `project ${live.id} is not in the trash`) : missing(c);
    }
    const result = await intents.restore(c, row);
    if (result instanceof Response) return result;
    // its app may still be in the trash: the project comes back app-less rather than pointing into the trash
    if (result.app_id !== null && (await appIssue(result.app_id))) {
      const at = now();
      const actor = c.get('actor');
      const [detached] = await db.update(projectTable).set({ app_id: null, updated_at: at }).where(eq(projectTable.id, result.id)).returning();
      if (!detached) throw new Error('update returned no row');
      await recordEvent(db, { entity_kind: 'project', entity_id: result.id, actor, kind: 'updated', prior: { app_id: result.app_id }, new: { app_id: null }, at });
      await moveTicketsOfProject({ db, actor, at }, result.id, null);
      return c.json(toProject(detached));
    }
    return c.json(toProject(result));
  });

  return r;
}
