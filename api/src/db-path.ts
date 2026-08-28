import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * `GF_DB_PATH` (tests, one-offs) or `~/.goblin-foundry/foundry.db`.
 * Kept driver-free so drizzle-kit (which runs on Node) can import it too.
 */
export function defaultDbPath(): string {
  return process.env.GF_DB_PATH ?? join(homedir(), '.goblin-foundry', 'foundry.db');
}
