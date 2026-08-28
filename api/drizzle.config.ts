import { defineConfig } from 'drizzle-kit';
import { defaultDbPath } from './src/db-path';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: defaultDbPath() },
});
