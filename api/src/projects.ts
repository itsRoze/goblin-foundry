import { Hono } from 'hono';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { diff } from '@goblin/history';
import { CreateProjectBodySchema, PatchProjectBodySchema, type Project } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { ctxOf, moveTicketsOfProject, releaseTicketsOfProject, reviveChildren } from './children';
import { changedWhile, commit, judgedRefusal, livePin, newestId, pinnedRowWrite } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { projectGraph } from './graph';
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
  const appStillLive = (appId: number | null) => (appId === null ? [] : [livePin(db, appTable, appId, `app ${appId}`)]);

  const { findLive, missing } = lifecycleRoutes<ProjectRow, Project>(r, {
    db,
    table: projectTable,
    kind: 'project',
    toWire: toProject,
    hooks: {
      onTrash: (ctx, row, cascade) => releaseTicketsOfProject(ctx, row.id, cascade),
      async onRestore(ctx, row) {
        const appGone = row.app_id !== null && (await appIssue(row.app_id)) !== null;
        const appId = appGone ? null : row.app_id;
        return { rehomed: { app_id: appId }, children: [...appStillLive(appId), ...(await reviveChildren(ctx, { kind: 'project', id: row.id, appId }))] };
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
    const written = await commit(
      c,
      db,
      [
        { what: 'project', statement: db.insert(projectTable).values({ ...fields, created_at: at, updated_at: at }).returning() },
        await eventWrite(db, { entity_kind: 'project', entity_id: newestId(projectTable), actor: c.get('actor'), kind: 'created', prior: null, new: fields, at }),
        ...appStillLive(fields.app_id),
      ],
      { rolledBack: 'the project was not created', stale: (what) => changedWhile(c, what, 'create') },
    );
    if (written instanceof Response) return written;
    return c.json(toProject(written[0] as ProjectRow), 201);
  });

  r.get('/:id', async (c) => {
    const row = await findLive(c);
    return row ? c.json(toProject(row)) : missing(c);
  });

  /** What the Project view draws: the project's tickets and their edges, one hop past the boundary (issue 08). */
  r.get('/:id/graph', async (c) => {
    const row = await findLive(c);
    return row ? c.json(await projectGraph(db, row.id)) : missing(c);
  });

  r.patch('/:id', async (c) => {
    const body = await parseBody(c, PatchProjectBodySchema);
    const row = await findLive(c);
    if (!row) return missing(c);
    if (!body.ok) return body.response;
    const change = diff(row, body.data);
    if (!change.changed) return c.json(toProject(row));
    const judgedAway = await judgedRefusal(c, row, body.data, () => changedWhile(c, `project ${row.id}`, 'the edit'));
    if (judgedAway) return judgedAway;
    const appId = change.new.app_id as number | null | undefined;
    if (appId !== undefined) {
      const issue = await appIssue(appId);
      if (issue) return unprocessable(c, [issue]);
    }
    const ctx = await ctxOf(db, c, now());
    const written = await commit(
      c,
      db,
      [
        pinnedRowWrite(db, projectTable, row, change.new, ctx.at, `project ${row.id}`),
        await eventWrite(db, { entity_kind: 'project', entity_id: row.id, actor: ctx.actor, kind: 'updated', prior: change.prior, new: change.new, at: ctx.at }),
        ...(appId === undefined ? [] : [...(await moveTicketsOfProject(ctx, row.id, appId)), ...appStillLive(appId)]),
      ],
      { rolledBack: 'the edit was rolled back', stale: (what) => changedWhile(c, what.startsWith('app ') ? what : `project ${row.id}`, 'the edit') },
    );
    if (written instanceof Response) return written;
    return c.json(toProject(written[0] as ProjectRow));
  });

  return r;
}
