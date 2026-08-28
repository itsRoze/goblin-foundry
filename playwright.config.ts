import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One built GUI + API process over a throwaway database. The smoke suite is
// the exit criterion made executable, not where behaviour is enumerated.
const port = 4790;
const dbPath = join(mkdtempSync(join(tmpdir(), 'gf-e2e-')), 'foundry.db');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts', // *.spec.ts would also be picked up by `bun test`
  timeout: 15_000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'bun run build && bun api/src/server.ts',
    url: `http://127.0.0.1:${port}/api/settings`,
    reuseExistingServer: false,
    env: { GF_DB_PATH: dbPath, GF_PORT: String(port) },
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
