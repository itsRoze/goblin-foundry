import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAllow } from '@goblin/shared';
import { admitOnly } from '../src/peers';

const vm = parseAllow('192.168.64.0/24');
if (!vm.ok) throw new Error('192.168.64.0/24 should parse');
const from = (address: string | null) => ({ requestIP: () => (address === null ? null : { address }) });
const guarded = admitOnly(vm.networks, () => new Response('the API'));

describe('a guarded fetch', () => {
  test('answers loopback and a peer inside a listed network', async () => {
    for (const peer of ['127.0.0.1', '::ffff:127.0.0.1', '::1', '192.168.64.5', '::ffff:192.168.64.5']) {
      const response = await guarded(new Request('http://x/api/settings'), from(peer));
      expect([peer, response.status, await response.text()]).toEqual([peer, 200, 'the API']);
    }
  });

  test('refuses every other peer with a 403 problem naming it', async () => {
    const response = await guarded(new Request('http://x/api/settings'), from('192.168.65.5'));
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({ type: 'about:blank', title: 'Forbidden', status: 403, detail: '192.168.65.5 is not in GF_ALLOW' });
  });

  test('a peer with no address is refused', async () => {
    const response = await guarded(new Request('http://x/api/settings'), from(null));
    expect(response.status).toBe(403);
    expect((await response.json()).detail).toBe('this peer is not in GF_ALLOW');
  });
});

describe('the server with GF_ALLOW', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-allow-'));
  const children: Bun.Subprocess[] = [];
  afterAll(async () => {
    await Promise.all(children.map((child) => (child.kill(), child.exited)));
    rmSync(dir, { recursive: true, force: true });
  });

  const start = (allow: string, port = '0') => {
    const child = Bun.spawn(['bun', 'src/server.ts'], {
      cwd: join(import.meta.dir, '..'),
      env: { ...process.env, GF_DB_PATH: join(dir, `${children.length}.db`), GF_PORT: port, GF_ALLOW: allow },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(child);
    return child;
  };

  /** Start it and wait for the boot line, which names the port it took. */
  const up = async (allow: string) => {
    const child = start(allow);
    const banner = new TextDecoder().decode((await child.stdout.getReader().read()).value);
    const port = /http:\/\/127\.0\.0\.1:(\d+)/.exec(banner)?.[1];
    if (!port) throw new Error(`no port in ${banner}`);
    return { banner, port };
  };

  test('still answers this Mac on 127.0.0.1, and says what it allows', async () => {
    const { banner, port } = await up('192.168.64.0/24');
    expect(banner).toContain('  allow=192.168.64.0/24\n');
    expect((await fetch(`http://127.0.0.1:${port}/api/settings`)).status).toBe(200);
  });

  /** macOS lets a 127.0.0.1 and a 0.0.0.0 listener share a port and Linux does not; on both a second server must be told the port is taken. */
  test('a second server on its port is refused, not handed the loopback traffic', async () => {
    const { port } = await up('192.168.64.0/24');
    const second = start('', port);
    expect(await second.exited).toBe(1);
    expect(await new Response(second.stderr).text()).toBe(`port ${port} is taken — stop the tracker with \`goblin service stop\`, or set GF_PORT to run beside it.\n`);
  });

  // a peer that is not loopback, without a VM: this machine calling its own LAN address
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((face) => face !== undefined && face.family === 'IPv4' && !face.internal)?.address;

  test.skipIf(lan === undefined)('answers a listed peer over a real socket and refuses one that is not listed', async () => {
    const listed = await up(`${lan}/32`);
    expect((await fetch(`http://${lan}:${listed.port}/api/settings`)).status).toBe(200);

    const unlisted = await up('192.0.2.0/24');
    const refused = await fetch(`http://${lan}:${unlisted.port}/api/settings`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ type: 'about:blank', title: 'Forbidden', status: 403, detail: `${lan} is not in GF_ALLOW` });
  });

  test('a malformed network fails boot with one line naming it', async () => {
    const child = start('192.168.64.0/24, 192.168.64.0/33');
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toBe('GF_ALLOW: "192.168.64.0/33" is not an IPv4 network like 192.168.64.0/24\n');
  });
});
