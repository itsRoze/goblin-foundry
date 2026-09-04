import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Issue 06: the board's Filter, on the wire. `/api/tickets` and `/api/frontier`
 * read the same four parameters through the shared parser.
 */
describe('the filter parameters', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown) => req(path, json('POST', body));
  const newTicket = (body: Record<string, unknown>) => post('/api/tickets', body).then((r) => r.json());
  const newApp = (name: string) => post('/api/apps', { name }).then((r) => r.json());
  const newProject = (name: string, app_id: number) => post('/api/projects', { name, app_id }).then((r) => r.json());

  const titles = async (path: string) => {
    const res = await req(path);
    expect([path, res.status]).toEqual([path, 200]);
    return ((await res.json()) as { title: string }[]).map((t) => t.title);
  };
  const issues = async (path: string) => {
    const res = await req(path);
    expect([path, res.status]).toEqual([path, 422]);
    return (await res.json()).issues;
  };

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  /** One board's worth of tickets, one in every shape the filters have to tell apart. */
  async function seed() {
    const app = await newApp('Subway Reader');
    const other = await newApp('Other');
    const project = await newProject('MVP', app.id);
    await newTicket({ title: 'orphan', description: 'nowhere in particular' });
    await newTicket({ title: 'in app', app_id: app.id, description: 'covers 100% of the feeds' });
    await newTicket({ title: 'in project', project_id: project.id });
    await newTicket({ title: 'elsewhere', app_id: other.id });
    const ready = await newTicket({ title: 'ready to go', app_id: app.id, simple: true, status: 'ready' });
    const done = await newTicket({ title: 'already done', app_id: app.id });
    await post(`/api/tickets/${done.key}/close`);
    const gone = await newTicket({ title: 'abandoned' });
    await post(`/api/tickets/${gone.key}/cancel`);
    return { app, other, project, ready };
  }

  test('the API default is every status, cancelled included — a list is not a board', async () => {
    await seed();
    expect(await titles('/api/tickets')).toEqual(['orphan', 'in app', 'in project', 'elsewhere', 'ready to go', 'already done', 'abandoned']);
  });

  test('each parameter alone', async () => {
    const { app, project } = await seed();
    expect(await titles(`/api/tickets?app_id=${app.id}`)).toEqual(['in app', 'in project', 'ready to go', 'already done']);
    expect(await titles(`/api/tickets?project_id=${project.id}`)).toEqual(['in project']);
    expect(await titles('/api/tickets?status=ready')).toEqual(['ready to go']);
    expect(await titles('/api/tickets?q=already')).toEqual(['already done']);
  });

  test('null is "has none", on either field', async () => {
    await seed();
    expect(await titles('/api/tickets?app_id=null')).toEqual(['orphan', 'abandoned']);
    expect(await titles('/api/tickets?project_id=null')).toEqual(['orphan', 'in app', 'elsewhere', 'ready to go', 'already done', 'abandoned']);
  });

  test('a status set is comma-separated, in any order', async () => {
    await seed();
    expect(await titles('/api/tickets?status=cancelled,ready')).toEqual(['ready to go', 'abandoned']);
  });

  test('the parameters compose: everything ANDs, and a project outside the app simply yields nothing', async () => {
    const { app, other, project } = await seed();
    expect(await titles(`/api/tickets?app_id=${app.id}&status=backlog&q=feeds`)).toEqual(['in app']);
    expect(await titles(`/api/tickets?app_id=${other.id}&project_id=${project.id}`)).toEqual([]);
  });

  test('q matches title or description, case-insensitively', async () => {
    await seed();
    expect(await titles('/api/tickets?q=IN%20APP')).toEqual(['in app']);
    expect(await titles('/api/tickets?q=FEEDS')).toEqual(['in app']);
    expect(await titles('/api/tickets?q=nothing here')).toEqual([]);
  });

  test('a % or _ in q matches itself, never everything', async () => {
    await newTicket({ title: '100% of the feeds' });
    await newTicket({ title: '100 feeds' });
    await newTicket({ title: 'snake_case' });
    await newTicket({ title: 'snakeXcase' });
    expect(await titles('/api/tickets?q=100%25')).toEqual(['100% of the feeds']);
    expect(await titles('/api/tickets?q=snake_')).toEqual(['snake_case']);
    expect(await titles('/api/tickets?q=%5C')).toEqual([]);
  });

  test('an empty parameter is unset, not a filter on emptiness', async () => {
    await seed();
    expect(await titles('/api/tickets?app_id=&project_id=&status=&q=')).toEqual(await titles('/api/tickets'));
  });

  test('an unknown status is a 422 on status; a GUI address is a 422 on the id', async () => {
    expect(await issues('/api/tickets?status=shipped')).toEqual([{ path: ['status'], message: 'shipped is not a status' }]);
    // the clients strip the slug; the wire only ever carries an id
    expect(await issues('/api/tickets?app_id=subway-reader-1')).toEqual([{ path: ['app_id'], message: 'expected an id or null' }]);
    expect(await issues('/api/tickets?project_id=x&status=nope')).toEqual([
      { path: ['project_id'], message: 'expected an id or null' },
      { path: ['status'], message: 'nope is not a status' },
    ]);
  });

  test('a trashed ticket is out of every filtered read', async () => {
    const { app } = await seed();
    await req('/api/tickets/GF-2', { method: 'DELETE' });
    expect(await titles(`/api/tickets?app_id=${app.id}`)).toEqual(['in project', 'ready to go', 'already done']);
  });

  describe('/api/frontier', () => {
    /** Two ready tickets in different apps, one of them blocked. */
    async function readySeed() {
      const app = await newApp('Subway Reader');
      const other = await newApp('Other');
      const project = await newProject('MVP', app.id);
      await newTicket({ title: 'parse a feed', project_id: project.id, simple: true, status: 'ready', description: 'rss and atom' });
      await newTicket({ title: 'render a list', app_id: app.id, simple: true, status: 'ready' });
      await newTicket({ title: 'somebody else', app_id: other.id, simple: true, status: 'ready' });
      return { app, other, project };
    }

    test('the frontier takes app, project and q through the same parser', async () => {
      const { app, project } = await readySeed();
      expect(await titles('/api/frontier')).toEqual(['parse a feed', 'render a list', 'somebody else']);
      expect(await titles(`/api/frontier?app_id=${app.id}`)).toEqual(['parse a feed', 'render a list']);
      expect(await titles(`/api/frontier?project_id=${project.id}`)).toEqual(['parse a feed']);
      expect(await titles('/api/frontier?q=RSS')).toEqual(['parse a feed']);
      expect(await titles(`/api/frontier?app_id=${app.id}&q=list`)).toEqual(['render a list']);
      expect(await titles('/api/frontier?project_id=null')).toEqual(['render a list', 'somebody else']);
    });

    test('a status on the frontier is refused rather than quietly dropped', async () => {
      await readySeed();
      expect(await issues('/api/frontier?status=ready')).toEqual([{ path: ['status'], message: 'the frontier is ready by definition' }]);
    });

    test('a bad value is refused there too', async () => {
      expect(await issues('/api/frontier?app_id=subway-reader-1')).toEqual([{ path: ['app_id'], message: 'expected an id or null' }]);
    });

    test('an open blocker still keeps a ticket out, filter or no filter', async () => {
      const { app } = await readySeed();
      await post('/api/tickets/GF-2/dependencies', { blocker: 'GF-1' });
      expect(await titles(`/api/frontier?app_id=${app.id}`)).toEqual(['parse a feed']);
    });
  });
});
