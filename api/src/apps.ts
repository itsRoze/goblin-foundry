import { Hono, type Context } from 'hono';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  CreateAppBodySchema,
  DEFAULT_BRANCH_NEEDS_REPOSITORY,
  PatchAppBodySchema,
  branchWithoutRepository,
  type App,
} from '@goblin/shared';
import type { ActorEnv } from './actor';
import { releaseChildrenOfApp, reviveChildren } from './children';
import type { Db } from './db';
import { diff, listEvents, now, recordEvent } from './events';
import { idParam, parseBody } from './http';
import { lifecycle, wantsArchived, wantsCascade } from './lifecycle';
import { conflict, notFound, unprocessable } from './problems';
import { app as appTable } from './schema';

type AppRow = typeof appTable.$inferSelect;
export const toApp = ({ trashed_via: _, ...row }: AppRow): App => row;

const branchIssue = { path: ['default_branch'], message: DEFAULT_BRANCH_NEEDS_REPOSITORY };

export function appsRoutes(db: Db) {
  const r = new Hono<ActorEnv>();
  const intents = lifecycle<AppRow>(db, appTable, 'app', {
    onTrash: (row, cascade, actor, at) => releaseChildrenOfApp({ db, actor, at }, row.id, cascade),
    onRestore: (row, actor, at) => reviveChildren({ db, actor, at }, 'app', row.id),
  });

  /** A trashed app is invisible except through `/api/trash` — every route here resolves live apps only. */
  async function findLive(c: Context): Promise<AppRow | undefined> {
    const id = idParam(c);
    if (id === null) return undefined;
    const rows = await db.select().from(appTable).where(and(eq(appTable.id, id), isNull(appTable.trashed_at)));
    return rows[0];
  }
  async function findTrashed(id: number | null): Promise<AppRow | undefined> {
    if (id === null) return undefined;
    const rows = await db.select().from(appTable).where(eq(appTable.id, id));
    return rows[0]?.trashed_at ? rows[0] : undefined;
  }
  const missing = (c: Context) => notFound(c, `app ${c.req.param('id')} not found`);

  r.get('/', async (c) => {
    const where = wantsArchived(c) ? isNull(appTable.trashed_at) : and(isNull(appTable.trashed_at), isNull(appTable.archived_at));
    const rows = await db.select().from(appTable).where(where).orderBy(asc(appTable.id));
    return c.json(rows.map(toApp));
  });

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateAppBodySchema);
    if (!body.ok) return body.response;
    if (branchWithoutRepository(body.data)) return unprocessable(c, [branchIssue]);
    const at = now();
    const fields = {
      name: body.data.name,
      repository_url: body.data.repository_url ?? null,
      default_branch: body.data.default_branch ?? null,
      description: body.data.description ?? '',
    };
    const [row] = await db.insert(appTable).values({ ...fields, created_at: at, updated_at: at }).returning();
    if (!row) throw new Error('insert returned no row');
    await recordEvent(db, { entity_kind: 'app', entity_id: row.id, actor: c.get('actor'), kind: 'created', prior: null, new: fields, at });
    return c.json(toApp(row), 201);
  });

  r.get('/:id', async (c) => {
    const row = await findLive(c);
    return row ? c.json(toApp(row)) : missing(c);
  });

  r.patch('/:id', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    const body = await parseBody(c, PatchAppBodySchema);
    if (!body.ok) return body.response;
    const change = diff(row, body.data);
    if (!change.changed) return c.json(toApp(row));
    if (branchWithoutRepository({ ...row, ...change.new })) return unprocessable(c, [branchIssue]);
    const at = now();
    const [updated] = await db.update(appTable).set({ ...change.new, updated_at: at }).where(eq(appTable.id, row.id)).returning();
    if (!updated) throw new Error('update returned no row');
    await recordEvent(db, { entity_kind: 'app', entity_id: row.id, actor: c.get('actor'), kind: 'updated', prior: change.prior, new: change.new, at });
    return c.json(toApp(updated));
  });

  r.get('/:id/events', async (c) => {
    const row = await findLive(c);
    return row ? c.json(await listEvents(db, 'app', row.id)) : missing(c);
  });

  r.post('/:id/archive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    const result = await intents.archive(c, row);
    return result instanceof Response ? result : c.json(toApp(result));
  });

  r.post('/:id/unarchive', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    const result = await intents.unarchive(c, row);
    return result instanceof Response ? result : c.json(toApp(result));
  });

  r.delete('/:id', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    return c.json(toApp(await intents.trash(c, row, wantsCascade(c))));
  });

  r.post('/:id/restore', async (c) => {
    const row = await findTrashed(idParam(c));
    if (!row) {
      // a live app is a 409 (nothing to restore); an unknown id a 404
      const live = await findLive(c);
      return live ? conflict(c, `app ${live.id} is not in the trash`) : missing(c);
    }
    const result = await intents.restore(c, row);
    return result instanceof Response ? result : c.json(toApp(result));
  });

  return r;
}
