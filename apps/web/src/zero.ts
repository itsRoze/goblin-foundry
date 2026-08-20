import { Zero } from '@rocicorp/zero';
import { schema } from '@goblin/schema/zero';
import { queries } from '@goblin/schema/queries';

export const zero = new Zero({
  server: import.meta.env.VITE_ZERO_URL ?? 'http://localhost:4849',
  userID: 'roze',
  schema,
  kvStore: 'idb',
});

// dev handle for poking at sync from the console
Object.assign(globalThis as unknown as Record<string, unknown>, { zero, queries });
