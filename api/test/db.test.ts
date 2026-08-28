import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { openDb } from '../src/db';

describe('openDb', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-db-'));
  const savedEnv = process.env.GF_DB_PATH;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GF_DB_PATH;
    else process.env.GF_DB_PATH = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  test('GF_DB_PATH redirects the default database to that file, in WAL mode', async () => {
    const wanted = join(dir, 'nested', 'test.db');
    process.env.GF_DB_PATH = wanted;
    const handle = await openDb();
    try {
      expect(existsSync(wanted)).toBe(true);
      const rows = await handle.db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
      expect(rows[0]?.journal_mode).toBe('wal');
    } finally {
      handle.close();
    }
  });
});
