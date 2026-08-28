import { afterEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from './harness';

describe('GET /api/settings', () => {
  let harness: Awaited<ReturnType<typeof makeTestApp>> | undefined;
  afterEach(() => harness?.close());

  test('a fresh database reports the default ticket prefix GF', async () => {
    harness = await makeTestApp();
    const res = await harness.app.request('/api/settings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ticket_prefix: 'GF' });
  });
});
