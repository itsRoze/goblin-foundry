import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { AtomicWriteError, atomically, openDb } from '../src/db';
import { setting } from '../src/schema';

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
      const rows = await handle.db
        .select({ journal_mode: sql<string>`journal_mode` })
        .from(sql`pragma_journal_mode`);
      expect(rows[0]?.journal_mode).toBe('wal');
    } finally {
      handle.close();
    }
  });
});

/** ADR-0010's boundary, at the seam itself: the route tests prove it through the API, these prove the two ways a batch ends early. */
describe('atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-atomic-'));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const put = (db: Awaited<ReturnType<typeof openDb>>['db'], key: string, value: string) => ({
    what: `setting ${key}`,
    statement: db.insert(setting).values({ key, value }).returning({ key: setting.key }),
  });

  test('a statement that matches no row is stale, and takes the writes before it back out', async () => {
    const handle = await openDb(join(dir, 'stale.db'));
    try {
      const { db } = handle;
      const vanished = { what: 'a row that is not there', statement: db.update(setting).set({ value: 'x' }).where(eq(setting.key, 'no-such-key')).returning({ key: setting.key }) };
      const attempt = atomically(db, [put(db, 'first', '1'), vanished, put(db, 'never', '3')]);
      await expect(attempt).rejects.toBeInstanceOf(AtomicWriteError);
      await expect(attempt).rejects.toMatchObject({ kind: 'stale' });
      expect(await db.select().from(setting).where(eq(setting.key, 'first'))).toEqual([]);
      // the connection is left usable: the next batch commits
      await atomically(db, [put(db, 'first', '1'), put(db, 'second', '2')]);
      expect((await db.select().from(setting).where(eq(setting.key, 'second')))[0]?.value).toBe('2');
    } finally {
      handle.close();
    }
  });

  test('a statement the database refuses is a fault, and rolls back the same way', async () => {
    const handle = await openDb(join(dir, 'fault.db'));
    try {
      const { db } = handle;
      // the second insert collides with the first on the primary key
      const attempt = atomically(db, [put(db, 'twice', '1'), put(db, 'twice', '2')]);
      await expect(attempt).rejects.toMatchObject({ kind: 'fault' });
      expect(await db.select().from(setting).where(eq(setting.key, 'twice'))).toEqual([]);
    } finally {
      handle.close();
    }
  });
});
