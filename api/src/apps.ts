import { Hono } from 'hono';
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
import { diff, now, recordEvent } from './events';
import { parseBody } from './http';
import { lifecycleRoutes, wantsArchived } from './lifecycle';
import { unprocessable } from './problems';
import { app as appTable } from './schema';

type AppRow = typeof appTable.$inferSelect;
export const toApp = ({ trashed_via: _, ...row }: AppRow): App => row;

const branchIssue = { path: ['default_branch'], message: DEFAULT_BRANCH_NEEDS_REPOSITORY };

export function appsRoutes(db: Db) {
  const r = new Hono<ActorEnv>();
  const { findLive, missing } = lifecycleRoutes<AppRow, App>(r, {
    db,
    table: appTable,
    kind: 'app',
    toWire: toApp,
    hooks: {
      onTrash: (ctx, row, cascade) => releaseChildrenOfApp(ctx, row.id, cascade),
      onRestore: (ctx, row) => reviveChildren(ctx, 'app', row.id),
    },
  });

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

  return r;
}
