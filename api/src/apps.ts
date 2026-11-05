import { Hono, type Context } from 'hono';
import { and, asc, isNull } from 'drizzle-orm';
import { diff } from '@goblin/history';
import {
  CreateAppBodySchema,
  DEFAULT_BRANCH_NEEDS_REPOSITORY,
  PatchAppBodySchema,
  branchWithoutRepository,
  type App,
} from '@goblin/shared';
import type { ActorEnv } from './actor';
import { releaseChildrenOfApp, reviveChildren } from './children';
import { resolveCheckout } from './checkout';
import { changedWhile, commit, judgedRefusal, newestId, pinnedRowWrite } from './commit';
import type { Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { lifecycleRoutes, wantsArchived } from './lifecycle';
import { conflict, unprocessable } from './problems';
import { app as appTable } from './schema';
import { readSettings } from './settings';
import { readBranches } from './worktree';

type AppRow = typeof appTable.$inferSelect;
export const toApp = ({ trashed_via: _, ...row }: AppRow): App => row;

const branchIssue = { path: ['default_branch'], message: DEFAULT_BRANCH_NEEDS_REPOSITORY };

/** The body with the folder it named replaced by what the Checkout records, or the refusal. Clearing and not mentioning it ask nothing of this machine. */
async function withResolvedCheckout<Body extends { checkout?: string | null }>(c: Context, body: Body): Promise<Body | Response> {
  if (!body.checkout) return body;
  const resolved = await resolveCheckout(body.checkout);
  return resolved.ok ? { ...body, checkout: resolved.folder } : unprocessable(c, [{ path: ['checkout'], message: resolved.reason }]);
}

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
    const data = await withResolvedCheckout(c, body.data);
    if (data instanceof Response) return data;
    const at = now();
    const fields = {
      name: data.name,
      repository_url: data.repository_url ?? null,
      default_branch: data.default_branch ?? null,
      checkout: data.checkout ?? null,
      description: data.description ?? '',
    };
    const written = await commit(
      c,
      db,
      [
        { what: 'app', statement: db.insert(appTable).values({ ...fields, created_at: at, updated_at: at }).returning() },
        await eventWrite(db, { entity_kind: 'app', entity_id: newestId(appTable), actor: c.get('actor'), kind: 'created', prior: null, new: fields, at }),
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

  r.get('/:id/branches', async (c) => {
    const row = await findLive(c);
    if (!row) return missing(c);
    if (!row.checkout) return conflict(c, `${row.name} has no Checkout, so it has no branches to read`);
    const { worktree_root } = await readSettings(db);
    const read = await readBranches(row.checkout, worktree_root);
    return read.ok ? c.json(read.branches) : conflict(c, read.reason);
  });

  r.patch('/:id', async (c) => {
    const body = await parseBody(c, PatchAppBodySchema);
    const row = await findLive(c);
    if (!row) return missing(c);
    if (!body.ok) return body.response;
    // the GUI's form resends the Checkout on every save, and a folder moved since it was recorded must not refuse a rename
    const data = body.data.checkout === row.checkout ? body.data : await withResolvedCheckout(c, body.data);
    if (data instanceof Response) return data;
    const change = diff(row, data);
    if (!change.changed) return c.json(toApp(row));
    const judgedAway = await judgedRefusal(c, row, data, () => changedWhile(c, `app ${row.id}`, 'the edit'));
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
