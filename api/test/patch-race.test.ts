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

  /** A request whose body is sent only when `finish` is called; `done` is the status line and body that came back. */
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

  test('a transition that lands while the body is in flight is a 409 for the edit, and the ticket keeps the design the guard needs', async () => {
    const app = await call('POST', '/api/apps', { name: 'Reader' }).then((r) => r.json());
    const t = await call('POST', '/api/tickets', { title: 'racing', status: 'todo', app_id: app.id, simple: false }).then((r) => r.json());
    expect((await call('PATCH', `/api/tickets/${t.key}`, { design: 'the plan' })).status).toBe(200);

    const edit = await held('PATCH', `/api/tickets/${t.key}`, { design: null });
    // give the server the headers before the other connection moves the ticket
    await Bun.sleep(100);
    const approve = await call('POST', `/api/tickets/${t.key}/approve`);
    expect([approve.status, (await approve.json()).status]).toEqual([200, 'ready']);

    const answer = await edit.finish();
    expect(answer.split('\r\n')[0]).toBe('HTTP/1.1 409 Conflict');
    expect(answer).toContain(`ticket ${t.key} changed while the edit was being applied`);

    const after = await call('GET', `/api/tickets/${t.key}`).then((r) => r.json());
    expect([after.status, after.design, after.simple]).toEqual(['ready', 'the plan', false]);
  });
});
