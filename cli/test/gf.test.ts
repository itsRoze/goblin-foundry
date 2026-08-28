import { afterEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from '@gf/api/test/harness';
import { runGf } from '../src/run';

describe('gf settings', () => {
  let t: Awaited<ReturnType<typeof makeTestApp>> | undefined;
  afterEach(() => t?.close());

  test('prints the settings JSON from the API', async () => {
    t = await makeTestApp();
    const app = t.app;
    const r = await runGf(['settings'], { fetch: async (path, init) => app.request(path, init) });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ ticket_prefix: 'GF' });
  });

  test('unknown commands fail with usage', async () => {
    const r = await runGf(['nope'], { fetch: () => Promise.reject(new Error('unreachable')) });
    expect(r.code).toBe(1);
    expect(r.out).toContain('unknown command');
  });
});
