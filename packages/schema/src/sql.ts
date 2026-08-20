import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url = process.env.PG_URL): Sql {
  if (!url) throw new Error('PG_URL is not set (copy .env.example to .env)');
  return postgres(url, { onnotice: () => {} });
}

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/** Apply every sql/*.sql not yet recorded in _migration, in filename order. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`create table if not exists _migration (
    name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from _migration`).map(r => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await sql.begin(async tx => {
      await tx.unsafe(readFileSync(join(sqlDir, file), 'utf8'));
      await tx`insert into _migration (name) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
