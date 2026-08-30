import { Hono } from 'hono';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { CreateProjectBodySchema, PatchProjectBodySchema, type Project } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { moveTicketsOfProject, releaseTicketsOfProject, reviveChildren, type Ctx } from './children';
import type { Db } from './db';
import { diff, now, recordEvent } from './events';
import { parseBody } from './http';
import { lifecycleRoutes, wantsArchived } from './lifecycle';
import { unprocessable } from './problems';
import { app as appTable, project as projectTable } from './schema';

type ProjectRow = typeof projectTable.$inferSelect;
export const toProject = ({ trashed_via: _, ...row }: ProjectRow): Project => row;

export function projectsRoutes(db: Db) {
  const r = new Hono<ActorEnv>();

  /** A project's app must be a live app (archived is fine: archiving is about navigation). */
  async function appIssue(appId: number | null | undefined) {
    if (appId === null || appId === undefined) return null;
    const rows = await db.select({ trashed_at: appTable.trashed_at }).from(appTable).where(eq(appTable.id, appId));
    const row = rows[0];
    return row && !row.trashed_at ? null : { path: ['app_id'], message: `app ${appId} not found` };
  }

  /** Re-home a project (attach, move, or detach); its tickets follow (ADR-0007). */
  async function setApp(ctx: Ctx, row: ProjectRow, appId: number | null): Promise<ProjectRow> {
    const [updated] = await db.update(projectTable).set({ app_id: appId, updated_at: ctx.at }).where(eq(projectTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, { entity_kind: 'project', entity_id: row.id, actor: ctx.actor, kind: 'updated', prior: { app_id: row.app_id }, new: { app_id: appId }, at: ctx.at });
    await moveTicketsOfProject(ctx, row.id, appId);
    return updated;
  }

  const { findLive, missing } = lifecycleRoutes<ProjectRow, Project>(r, {
    db,
    table: projectTable,
    kind: 'project',
    toWire: toProject,
    hooks: {
      onTrash: (ctx, row, cascade) => releaseTicketsOfProject(ctx, row.id, cascade),
      async onRestore(ctx, row) {
        await reviveChildren(ctx, 'project', row.id);
        // its app may still be in the trash: the project comes back app-less rather than pointing into the trash
        if (row.app_id !== null && (await appIssue(row.app_id))) return setApp(ctx, row, null);
      },
    },
  });

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
    const fields = { name: body.data.name, description: body.data.description ?? '', design: body.data.design ?? null, app_id: body.data.app_id ?? null };
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
    const { app_id, ...fields } = change.new as { app_id?: number | null; name?: string; description?: string; design?: string | null };
    if (app_id !== undefined) {
      const issue = await appIssue(app_id);
      if (issue) return unprocessable(c, [issue]);
    }
    const ctx: Ctx = { db, actor: c.get('actor'), at: now() };
    let updated = row;
    if (Object.keys(fields).length) {
      const [next] = await db.update(projectTable).set({ ...fields, updated_at: ctx.at }).where(eq(projectTable.id, row.id)).returning();
      if (!next) throw new Error('update returned no row');
      const { app_id: _p, ...prior } = change.prior;
      await recordEvent(db, { entity_kind: 'project', entity_id: row.id, actor: ctx.actor, kind: 'updated', prior, new: fields, at: ctx.at });
      updated = next;
    }
    if (app_id !== undefined) updated = await setApp(ctx, updated, app_id);
    return c.json(toProject(updated));
  });

  return r;
}
