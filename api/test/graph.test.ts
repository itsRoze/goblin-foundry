import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TicketStatus, TransitionName } from '@goblin/shared';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** How to walk from `backlog` to each status using nothing but legal edges (mirrors `dependencies.test.ts`). */
const ROUTE: Record<TicketStatus, TransitionName[]> = {
  backlog: [],
  todo: ['pick'],
  planning: ['plan'],
  ready: ['pick', 'approve'],
  building: ['pick', 'approve', 'start'],
  review: ['pick', 'approve', 'start', 'submit'],
  done: ['pick', 'approve', 'start', 'submit', 'ship'],
  cancelled: ['cancel'],
};

/**
 * The project graph read. What is drawn is what is answered, so every test
 * here is about what is present and what is missing — a trashed thing is
 * hidden everywhere, and a cancelled one blocks nothing and is waited on by
 * nothing (CONTEXT.md).
 */
describe('GET /api/projects/:id/graph', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const create = (path: string, body: unknown) => post(path, body).then((r) => r.json());

  let appId: number;
  let projectId: number;
  beforeEach(async () => {
    h = await makeTestApp();
    appId = (await create('/api/apps', { name: 'Subway Reader' })).id;
    projectId = (await create('/api/projects', { name: 'MVP', app_id: appId })).id;
  });
  afterEach(() => h.close());

  interface Made {
    key: string;
    id: number;
  }

  /** A simple ticket (so the approve guard passes) in this project unless told otherwise, parked at `status`. */
  const ticket = async (title: string, extra: { status?: TicketStatus; description?: string; project_id?: number | null; app_id?: number | null } = {}): Promise<Made> => {
    const { status = 'backlog' as TicketStatus, description = '', ...home } = extra;
    const body = { title, description, simple: true, ...('project_id' in home || 'app_id' in home ? home : { project_id: projectId }) };
    const t = await create('/api/tickets', body);
    for (const name of ROUTE[status]) expect((await post(`/api/tickets/${t.key}/${name}`)).status).toBe(200);
    return { key: t.key, id: t.id };
  };

  /** `a` blocks `b`. */
  const block = async (a: Made, b: Made) => expect((await post(`/api/tickets/${b.key}/dependencies`, { blocker: a.key })).status).toBe(200);
  const trash = (t: Made) => req(`/api/tickets/${t.key}`, { method: 'DELETE' });

  const graph = (id: number = projectId) => req(`/api/projects/${id}/graph`).then((r) => r.json());
  const keys = (g: { nodes: { key: string }[] }) => g.nodes.map((n) => n.key);

  test('two dependent tickets are two nodes and one edge, blocker first', async () => {
    const a = await ticket('the groundwork', { description: 'dig the hole' });
    const b = await ticket('the thing that waits');
    await block(a, b);

    expect(await graph()).toEqual({
      nodes: [
        { key: a.key, title: 'the groundwork', status: 'backlog', blocked_by: [], description_line: 'dig the hole' },
        { key: b.key, title: 'the thing that waits', status: 'backlog', blocked_by: [a.key], description_line: '' },
      ],
      edges: [{ blocker: a.key, blocked: b.key }],
    });
  });

  test('a satisfied edge is still drawn — an edge is a durable fact (ADR-0009)', async () => {
    const a = await ticket('the groundwork', { status: 'done' });
    const b = await ticket('the thing that waits');
    await block(a, b);

    const g = await graph();
    expect(g.edges).toEqual([{ blocker: a.key, blocked: b.key }]);
    // nothing stands in its way any more, and the node says so by its status alone
    expect(g.nodes.find((n: { key: string }) => n.key === b.key).blocked_by).toEqual([]);
    expect(g.nodes.find((n: { key: string }) => n.key === a.key).status).toBe('done');
  });

  test('a trashed ticket is hidden here as everywhere, and takes its edges with it', async () => {
    const a = await ticket('the groundwork');
    const b = await ticket('the thing that waits');
    const gone = await ticket('a mistake');
    await block(a, b);
    await block(gone, b);
    await trash(gone);

    const g = await graph();
    expect(keys(g)).toEqual([a.key, b.key]);
    expect(g.edges).toEqual([{ blocker: a.key, blocked: b.key }]);
  });

  test('a cancelled ticket is not drawn and neither is the chain through it: A → C(cancelled) → B is two nodes and no edge', async () => {
    const a = await ticket('a');
    const c = await ticket('c', { status: 'cancelled' });
    const b = await ticket('b');
    await block(a, c);
    await block(c, b);

    const g = await graph();
    expect(keys(g)).toEqual([a.key, b.key]);
    expect(g.edges).toEqual([]);
  });

  test('an out-of-project end is one external node naming where it lives, with nothing of its own behind it', async () => {
    const other = await create('/api/projects', { name: 'Someday', app_id: appId });
    const mine = await ticket('mine');
    const theirs = await ticket('theirs', { project_id: other.id });
    // one hop past the boundary: this must not be drawn, and must not reach `theirs.blocked_by`
    const beyond = await ticket('beyond', { project_id: other.id });
    await block(theirs, mine);
    await block(beyond, theirs);

    const g = await graph();
    expect(keys(g)).toEqual([mine.key, theirs.key]);
    expect(g.nodes.find((n: { key: string }) => n.key === theirs.key)).toEqual({
      key: theirs.key,
      title: 'theirs',
      status: 'backlog',
      blocked_by: [],
      description_line: '',
      external: { app: 'Subway Reader', project: 'Someday' },
    });
    expect(g.nodes.find((n: { key: string }) => n.key === mine.key).external).toBeUndefined();
    expect(g.edges).toEqual([{ blocker: theirs.key, blocked: mine.key }]);
  });

  test('an orphan external says so rather than naming a home it has not got', async () => {
    const mine = await ticket('mine');
    const orphan = await ticket('an idea', { app_id: null, project_id: null });
    await block(orphan, mine);

    const g = await graph();
    expect(g.nodes.find((n: { key: string }) => n.key === orphan.key).external).toEqual({ app: null, project: null });
  });

  test('a cancelled or trashed external end is absent, edge and all', async () => {
    const other = await create('/api/projects', { name: 'Someday', app_id: appId });
    const mine = await ticket('mine');
    const dropped = await ticket('not doing that', { project_id: other.id, status: 'cancelled' });
    const binned = await ticket('a mistake', { project_id: other.id });
    await block(dropped, mine);
    await block(binned, mine);
    await trash(binned);

    const g = await graph();
    expect(keys(g)).toEqual([mine.key]);
    expect(g.edges).toEqual([]);
  });

  test('the description line is the first non-empty line, never the whole markdown', async () => {
    const t = await ticket('written up', { description: '\n\n  # A heading  \n\nthe second paragraph\n' });
    const g = await graph();
    expect(g.nodes.find((n: { key: string }) => n.key === t.key).description_line).toBe('# A heading');
  });

  test('a project with no tickets draws nothing; a missing or trashed one is a 404', async () => {
    expect(await graph()).toEqual({ nodes: [], edges: [] });
    expect((await req('/api/projects/999/graph')).status).toBe(404);

    await req(`/api/projects/${projectId}`, { method: 'DELETE' });
    expect((await req(`/api/projects/${projectId}/graph`)).status).toBe(404);
  });
});
