import { Hono } from 'hono';
import { and, asc, isNull } from 'drizzle-orm';
import {
  CreateAppBodySchema,
  DEFAULT_BRANCH_NEEDS_REPOSITORY,
  PatchAppBodySchema,
  branchWithoutRepository,
  type App,
} from '@goblin/shared';
import type { ActorEnv } from './actor';
import { releaseChildrenOfApp, reviveChildren } from './children';
import { changedWhile, commit, judgedRefusal, newestId, pinnedRowWrite } from './commit';
import type { Db } from './db';
import { diff, eventWrite, now } from './events';
import { parseBody } from './http';
import { lifecycleRoutes, wantsArchived } from './lifecycle';
import { unprocessable } from './problems';
import { app as appTable, event } from './schema';

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
      onRestore: async (ctx, row) => ({ children: await reviveChildren(ctx, { kind: 'app', id: row.id }) }),
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
    const written = await commit(
      c,
      db,
      [
        { what: 'app', statement: db.insert(appTable).values({ ...fields, created_at: at, updated_at: at }).returning() },
        {
          what: 'created event',
          statement: db.insert(event).values({ entity_kind: 'app', entity_id: newestId(appTable), actor: c.get('actor'), kind: 'created', prior: null, new: fields, at }).returning({ id: event.id }),
        },
      ],
      { rolledBack: 'the app was not created' },
    );
    if (written instanceof Response) return written;
    return c.json(toApp(written[0] as AppRow), 201);
  });

  r.get('/:id', async (c) => {
    const row = await findLive(c);
    return row ? c.json(toApp(row)) : missing(c);
  });

  r.patch('/:id', async (c) => {
    const body = await parseBody(c, PatchAppBodySchema);
    const row = await findLive(c);
    if (!row) return missing(c);
    if (!body.ok) return body.response;
    const change = diff(row, body.data);
    if (!change.changed) return c.json(toApp(row));
    const judgedAway = await judgedRefusal(c, row, body.data, () => changedWhile(c, `app ${row.id}`, 'the edit'));
    if (judgedAway) return judgedAway;
    if (branchWithoutRepository({ ...row, ...change.new })) return unprocessable(c, [branchIssue]);
    const at = now();
    const written = await commit(
      c,
      db,
      [pinnedRowWrite(db, appTable, row, change.new, at, `app ${row.id}`), await eventWrite(db, { entity_kind: 'app', entity_id: row.id, actor: c.get('actor'), kind: 'updated', prior: change.prior, new: change.new, at })],
      { rolledBack: 'the edit was rolled back', stale: () => changedWhile(c, `app ${row.id}`, 'the edit') },
    );
    if (written instanceof Response) return written;
    return c.json(toApp(written[0] as AppRow));
  });

  return r;
}
