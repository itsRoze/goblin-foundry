import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

type Harness = Awaited<ReturnType<typeof makeTestApp>>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('Labels on a Ticket (ADR-0013)', () => {
  let h: Harness;
  const req = (path: string, init?: RequestInit) => Promise.resolve(h.app.request(path, init));
  const post = (path: string, body?: unknown, headers?: Record<string, string>) => req(path, json('POST', body, headers));
  const newTicket = (body: Record<string, unknown>) => post('/api/tickets', body).then((r) => r.json());
  const show = (key: string) => req(`/api/tickets/${key}`).then((r) => r.json());
  const events = (key: string) => req(`/api/tickets/${key}/events`).then((r) => r.json());
  const setLabels = (key: string, labels: unknown, headers?: Record<string, string>) => post(`/api/tickets/${key}/labels`, { labels }, headers);

  beforeEach(async () => (h = await makeTestApp()));
  afterEach(() => h.close());

  test('a ticket created with labels carries them normalised, de-duplicated and in the order given', async () => {
    const res = await post('/api/tickets', { title: 'triage me', labels: [' Needs-Info', 'wayfinder:research', 'needs-info '] });
    expect(res.status).toBe(201);
    expect((await res.json()).labels).toEqual(['needs-info', 'wayfinder:research']);
    expect((await show('GF-1')).labels).toEqual(['needs-info', 'wayfinder:research']);
  });

  test('setting the whole set replaces it and answers with the ticket', async () => {
    await newTicket({ title: 'x', labels: ['a', 'b'] });
    const res = await setLabels('GF-1', ['B', 'c']);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: 'GF-1', labels: ['b', 'c'] });
    expect((await show('GF-1')).labels).toEqual(['b', 'c']);
    expect((await (await setLabels('GF-1', [])).json()).labels).toEqual([]);
  });

  test("a malformed name is refused with the Piece's sentence, and nothing changes", async () => {
    await newTicket({ title: 'x', labels: ['keep'] });
    for (const [labels, sentence] of [
      [['fine', '  '], 'a label cannot be blank'],
      [['needs info'], 'needs info is not one word: a label has no spaces or commas'],
    ] as const) {
      const res = await setLabels('GF-1', labels);
      expect(res.status).toBe(422);
      expect((await res.json()).issues).toEqual([{ path: ['labels'], message: sentence }]);
    }
    expect((await show('GF-1')).labels).toEqual(['keep']);
    expect((await events('GF-1')).map((e: { kind: string }) => e.kind)).toEqual(['created']);
  });

  test('a malformed name at creation creates nothing', async () => {
    const res = await post('/api/tickets', { title: 'x', labels: ['a,b'] });
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toEqual([{ path: ['labels'], message: 'a,b is not one word: a label has no spaces or commas' }]);
    expect(await req('/api/tickets').then((r) => r.json())).toEqual([]);
  });

  test('every change is its own history row with the actor and both whole sets; the same set again writes nothing', async () => {
    await newTicket({ title: 'x', labels: ['a'] });
    await setLabels('GF-1', ['a', 'needs-info'], { 'X-Goblin-Actor': 'agent' });
    await setLabels('GF-1', ['needs-info']);
    await setLabels('GF-1', ['Needs-Info']);
    const history = await events('GF-1');
    expect(history.map((e: { kind: string }) => e.kind)).toEqual(['labelled', 'labelled', 'created']);
    expect(history[0]).toMatchObject({ actor: 'human', prior: { labels: ['a', 'needs-info'] }, new: { labels: ['needs-info'] } });
    expect(history[1]).toMatchObject({ actor: 'agent', prior: { labels: ['a'] }, new: { labels: ['a', 'needs-info'] } });
    expect(history[2]).toMatchObject({ kind: 'created', new: expect.objectContaining({ labels: ['a'] }) });
  });

  test('the same names in another order are the same set: no write, no history, the order kept', async () => {
    await newTicket({ title: 'x', labels: ['a', 'b'] });
    const res = await setLabels('GF-1', ['B', 'a']);
    expect(res.status).toBe(200);
    expect((await res.json()).labels).toEqual(['a', 'b']);
    expect((await events('GF-1')).map((e: { kind: string }) => e.kind)).toEqual(['created']);
  });

  test('a create whose history cannot be written leaves no ticket behind', async () => {
    await newTicket({ title: 'first' });
    h.failWrites('event', 2);
    const res = await post('/api/tickets', { title: 'second', labels: ['a'] });
    expect(res.status).toBe(500);
    h.healWrites();
    expect((await req('/api/tickets').then((r) => r.json())).map((t: { key: string }) => t.key)).toEqual(['GF-1']);
    expect((await req('/api/tickets/GF-2')).status).toBe(404);
  });

  test('the names in use: every label on a live ticket, once each and sorted, whatever its app or status; none from the trash', async () => {
    const app = await post('/api/apps', { name: 'other' }).then((r) => r.json());
    await newTicket({ title: 'x', labels: ['needs-info', 'wayfinder:task'] });
    await newTicket({ title: 'y', labels: ['wayfinder:task', 'chore'], app_id: app.id });
    await newTicket({ title: 'z', labels: ['gone'] });
    await post('/api/tickets/GF-1/cancel');
    await req('/api/tickets/GF-3', { method: 'DELETE' });
    const res = await req('/api/labels');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(['chore', 'needs-info', 'wayfinder:task']);
  });

  test('labels come back on every read of the ticket: the list, the frontier, a transition, an edit', async () => {
    const app = await post('/api/apps', { name: 'a' }).then((r) => r.json());
    await newTicket({ title: 'x', status: 'planning', simple: true, app_id: app.id, labels: ['wayfinder:task'] });
    expect((await req('/api/tickets').then((r) => r.json()))[0].labels).toEqual(['wayfinder:task']);
    expect((await post('/api/tickets/GF-1/approve').then((r) => r.json())).labels).toEqual(['wayfinder:task']);
    expect((await req('/api/frontier').then((r) => r.json()))[0].labels).toEqual(['wayfinder:task']);
    expect((await req('/api/tickets/GF-1', json('PATCH', { title: 'y' })).then((r) => r.json())).labels).toEqual(['wayfinder:task']);
  });

  test('trash then restore keeps the labels, and the trash shows them meanwhile', async () => {
    await newTicket({ title: 'x', labels: ['needs-info'] });
    expect((await req('/api/tickets/GF-1', { method: 'DELETE' }).then((r) => r.json())).labels).toEqual(['needs-info']);
    expect((await req('/api/trash').then((r) => r.json())).tickets[0].labels).toEqual(['needs-info']);
    expect((await post('/api/tickets/GF-1/restore').then((r) => r.json())).labels).toEqual(['needs-info']);
    expect((await show('GF-1')).labels).toEqual(['needs-info']);
  });

  test("a bulk transition leaves every ticket's labels unchanged", async () => {
    await newTicket({ title: 'one', labels: ['a'] });
    await newTicket({ title: 'two', labels: ['b', 'c'] });
    await newTicket({ title: 'three' });
    const res = await post('/api/tickets/bulk', { tickets: ['GF-1', 'GF-2', 'GF-3'], action: { kind: 'transition', name: 'pick' } });
    expect(res.status).toBe(200);
    expect((await res.json()).tickets.map((t: { labels: string[] }) => t.labels)).toEqual([['a'], ['b', 'c'], []]);
    for (const [key, labels] of [['GF-1', ['a']], ['GF-2', ['b', 'c']], ['GF-3', []]] as const) expect((await show(key)).labels).toEqual(labels);
  });

  test('a trashed ticket has no labels to set', async () => {
    await newTicket({ title: 'x' });
    await req('/api/tickets/GF-1', { method: 'DELETE' });
    expect((await setLabels('GF-1', ['a'])).status).toBe(404);
  });

  test('a set whose history cannot be written is rolled back whole', async () => {
    await newTicket({ title: 'x', labels: ['a'] });
    h.failWrites('event', 1);
    const res = await setLabels('GF-1', ['b']);
    expect(res.status).toBe(500);
    h.healWrites();
    expect((await show('GF-1')).labels).toEqual(['a']);
  });
});
