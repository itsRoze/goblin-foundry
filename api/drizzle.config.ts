import { defineConfig } from 'drizzle-kit';
import { homedir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.GF_DB_PATH ?? join(homedir(), '.goblin-foundry', 'foundry.db') },
});
