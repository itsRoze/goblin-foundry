import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The one race `app.request` cannot stage: a request whose headers have
 * arrived and whose body has not. The real server over a real socket, on its
 * own throwaway database, is the only surface where a PATCH can be held open
 * while another connection moves the ticket underneath it (GF-37).
 */
/** TCP acknowledges nothing above bytes, so this is how long the headers get to reach the handler before the other connection moves the ticket. */
const HEADERS_ARRIVED_MS = 100;

describe('PATCH /api/tickets/:key with the body held open', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-race-'));
  let server: Bun.Subprocess<'ignore', 'pipe', 'inherit'>;
  let base: string;

  beforeAll(async () => {
    server = Bun.spawn(['bun', 'src/server.ts'], {
      cwd: join(import.meta.dir, '..'),
      env: { ...process.env, GF_DB_PATH: join(dir, 'foundry.db'), GF_PORT: '0' },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const banner = await server.stdout.getReader().read();
    const port = /http:\/\/127\.0\.0\.1:(\d+)/.exec(new TextDecoder().decode(banner.value))?.[1];
    if (!port) throw new Error('the server never said which port it took');
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  /** A request whose body is sent only when `finish` is called. */
  async function held(method: string, path: string, body: unknown) {
    const payload = JSON.stringify(body);
    const chunks: Uint8Array[] = [];
    let settle: (text: string) => void = () => {};
    const done = new Promise<string>((resolve) => (settle = resolve));
    const { port } = new URL(base);
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: Number(port),
      socket: {
        data: (_s, chunk) => {
          chunks.push(chunk);
        },
        close: () => settle(new TextDecoder().decode(Buffer.concat(chunks))),
        error: () => settle(new TextDecoder().decode(Buffer.concat(chunks))),
      },
    });
    socket.write(`${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n`);
    socket.flush();
    return {
      finish: () => {
        socket.write(payload);
        socket.flush();
        return done;
      },
    };
  }

  test('a transition that lands while the body is in flight is judged against the status it landed in, and the ticket keeps the design the guard needs', async () => {
    const app = await call('POST', '/api/apps', { name: 'Reader' }).then((r) => r.json());
    const t = await call('POST', '/api/tickets', { title: 'racing', status: 'todo', app_id: app.id, simple: false }).then((r) => r.json());
    expect((await call('PATCH', `/api/tickets/${t.key}`, { design: 'the plan' })).status).toBe(200);

    const edit = await held('PATCH', `/api/tickets/${t.key}`, { design: null });
    await Bun.sleep(HEADERS_ARRIVED_MS);
    const approve = await call('POST', `/api/tickets/${t.key}/approve`);
    expect([approve.status, (await approve.json()).status]).toEqual([200, 'ready']);

    const answer = await edit.finish();
    expect(answer.split('\r\n')[0]).toBe('HTTP/1.1 422 Unprocessable Entity');
    expect(JSON.parse(answer.slice(answer.indexOf('\r\n\r\n') + 4)).issues).toEqual([{ path: ['design'], message: 'a ticket in ready needs a description or a ticket design — unapprove it first' }]);

    const after = await call('GET', `/api/tickets/${t.key}`).then((r) => r.json());
    expect([after.status, after.design, after.simple]).toEqual(['ready', 'the plan', false]);
  });

  /**
   * An App or Project edit reads its row after the body has arrived, as a
   * Ticket edit does, so the body's transfer time is outside the pin's window:
   * an edit that lands meanwhile is not a reason to refuse this one, and both
   * stick.
   */
  test.each([
    ['apps', (id: number) => ({ path: `/api/apps/${id}`, make: { name: 'Reader' } })],
    ['projects', (id: number) => ({ path: `/api/projects/${id}`, make: { name: 'P' } })],
  ] as const)('an edit of an %s row that lands while another edit\'s body is in flight leaves both edits standing', async (noun, of) => {
    const row = await call('POST', `/api/${noun}`, of(0).make).then((r) => r.json());
    const { path } = of(row.id);
    const edit = await held('PATCH', path, { name: 'renamed while held' });
    await Bun.sleep(HEADERS_ARRIVED_MS);
    const meanwhile = await call('PATCH', path, { description: 'landed first' });
    expect(meanwhile.status).toBe(200);

    const answer = await edit.finish();
    expect(answer.split('\r\n')[0]).toBe('HTTP/1.1 200 OK');
    expect(await call('GET', path).then((r) => r.json())).toMatchObject({ name: 'renamed while held', description: 'landed first' });
  });
});
