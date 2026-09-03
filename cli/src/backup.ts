/**
 * The one command that is not a client. A backup is a copy of the file, so it
 * goes through `backupTo` in the API's database seam (ADR-0001's second
 * carve-out) rather than over HTTP — and rather than importing the driver
 * here, which the seam exists to prevent.
 *
 * It therefore reads the database the same way the server does: `GF_DB_PATH`,
 * else `~/.goblin-foundry/foundry.db`. Both run on the one laptop, so there is
 * nothing to reconcile; a server started against another file needs the same
 * `GF_DB_PATH` in this shell.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from './args';

/** `foundry-2026-09-02T140355.db` — UTC, to the second, so backups sort by name and a rerun within the second is an obvious collision. */
function backupName(at: Date): string {
  const iso = at.toISOString();
  return `foundry-${iso.slice(0, 10)}T${iso.slice(11, 19).replaceAll(':', '')}.db`;
}

export async function backupCommand(dir: string): Promise<{ text: string }> {
  // the directory is chosen, never created: a typo'd path would otherwise become a backup nobody can find
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`${dir} is not a directory`, 'make it first, then run the backup');

  // loaded here rather than at the top of the file so no other command pays for the driver
  const { backupTo, defaultDbPath } = await import('@goblin/api/src/db');
  const source = defaultDbPath();
  if (!existsSync(source)) throw new UsageError(`there is no database at ${source}`, 'set GF_DB_PATH if it lives somewhere else');

  const path = join(dir, backupName(new Date()));
  if (existsSync(path)) throw new UsageError(`${path} already exists`, 'backups are named to the second — wait one');
  backupTo(source, path);
  return { text: JSON.stringify({ path, source, bytes: statSync(path).size }) };
}
