import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One built GUI + API process over a throwaway database. The smoke suite is
// the exit criterion made executable, not where behaviour is enumerated.
// One worker: every spec writes to that one database, so they must not
// interleave (a spec that counts apps cannot share the file with one creating them).
// Worktrees run their suites concurrently, and a second run on the same port either fails
// outright or — worse — silently drives the *other* worktree's build. `GF_E2E_PORT` gives a
// run its own.
const port = Number(process.env.GF_E2E_PORT ?? 4790);
const dbPath = join(mkdtempSync(join(tmpdir(), 'gf-e2e-')), 'foundry.db');

/**
 * The touch specs (issue 11) run under real touch emulation on a phone-sized
 * screen in both engines the ticket names — Chromium for Android Chrome,
 * WebKit for iOS Safari — after the desktop specs, on the same database. A
 * mouse in a phone-sized window is not a finger, so they are their own
 * projects rather than a viewport change inside the desktop one. Emulation is
 * not a device: what it shows is reported as such (docs/tickets/s1/11).
 */
const TOUCH_SPECS = '**/touch-*.e2e.ts';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts', // *.spec.ts would also be picked up by `bun test`
  timeout: 15_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'bun run build && bun api/src/server.ts',
    url: `http://127.0.0.1:${port}/api/settings`,
    reuseExistingServer: false,
    env: { GF_DB_PATH: dbPath, GF_PORT: String(port) },
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: TOUCH_SPECS },
    { name: 'chromium-touch', use: { ...devices['Pixel 5'] }, testMatch: TOUCH_SPECS },
    { name: 'webkit-touch', use: { ...devices['iPhone 13'] }, testMatch: TOUCH_SPECS },
  ],
});
