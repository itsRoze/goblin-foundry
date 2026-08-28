import { afterEach, describe, expect, test } from 'bun:test';
import { makeTestApp } from '@goblin/api/test/harness';
import { runGoblin } from '../src/run';

describe('goblin settings', () => {
  let harness: Awaited<ReturnType<typeof makeTestApp>> | undefined;
  afterEach(() => harness?.close());

  test('prints the settings JSON from the API', async () => {
    harness = await makeTestApp();
    const app = harness.app;
    const result = await runGoblin(['settings'], { fetch: async (path, init) => app.request(path, init) });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ ticket_prefix: 'GF' });
  });

  test('unknown commands fail with usage', async () => {
    const result = await runGoblin(['nope'], { fetch: () => Promise.reject(new Error('unreachable')) });
    expect(result.code).toBe(1);
    expect(result.out).toContain("unknown command 'nope'");
    expect(result.out).toContain('usage: goblin <command>');
  });
});
