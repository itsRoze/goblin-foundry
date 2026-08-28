import { afterEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

describe('GET /api/settings', () => {
  let t: Awaited<ReturnType<typeof makeTestApp>> | undefined;
  afterEach(() => t?.close());

  test('a fresh database reports the default ticket prefix GF', async () => {
    t = await makeTestApp();
    const res = await t.app.request('/api/settings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ticket_prefix: 'GF' });
  });

  test('each harness gets its own database', async () => {
    t = await makeTestApp();
    const other = await makeTestApp();
    try {
      expect(t.path).not.toBe(other.path);
    } finally {
      other.close();
    }
  });
});
