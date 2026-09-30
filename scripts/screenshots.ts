/** Rebuild first: bun run build && bun scripts/screenshots.ts
 * Synthetic fixtures only; never opens the user's tracker database.
 */
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../api/src/db';
import { createApp } from '../api/src/app';
import { app, project, ticket, dependency } from '../api/src/schema';
import type { TicketRow } from '../api/src/schema';

const dir = mkdtempSync(join(tmpdir(), 'goblin-screenshots-'));
const handle = await openDb(join(dir, 'demo.db'));
const now = new Date().toISOString();
const stamps = { created_at: now, updated_at: now };
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createApp(handle.db).fetch });
let browser;
try {
  await handle.db.insert(app).values({ id: 1, name: 'Fieldnotes', description: 'A quiet home for everything worth reading.', ...stamps });
  await handle.db.insert(project).values({
    id: 1, app_id: 1, name: 'Offline reading',
    description: 'A reading list that works wherever you are.',
    design: '# Read anywhere. Keep your place.\n\nSave an article once and read it on the train, in the air, or off the grid.\n\n## The first release\n\n- Extract clean, readable article content.\n- Cache a complete reading list on this device.\n- Restore reading position when you return.\n\n## Ready to ship when\n\nA saved article opens in airplane mode, keeps its typography, and remembers the last paragraph read.',
    ...stamps,
  });
  const fixtures: [string, TicketRow['status']][] = [
    ['Define the article model', 'done'],
    ['Extract readable content', 'done'],
    ['Build the local article store', 'review'],
    ['Design the reading view', 'building'],
    ['Cache articles for offline use', 'ready'],
    ['Restore reading position', 'ready'],
    ['Test the airplane-mode journey', 'planning'],
    ['Ship offline reading', 'planning'],
    ['Add keyboard navigation', 'todo'],
    ['Explore reading themes', 'backlog'],
  ];
  await handle.db.insert(ticket).values(fixtures.map(([title, status], i) => ({
    id: i + 1, title, status, app_id: 1, project_id: 1, simple: false,
    description: i === 5 ? 'Resume at the paragraph you left, even after closing the app.' : '',
    design: `# ${title}\n\nKeep the reading experience fast, predictable, and available offline.\n\n## Acceptance\n\n- Works without a network connection.\n- Preserves existing saved articles.\n- Includes coverage for the failure path.`,
    ...stamps,
  })));
  const edges = [[1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 7], [7, 8]];
  await handle.db.insert(dependency).values(edges.map(([blocker_id, blocked_id]) => ({ blocker_id: blocker_id!, blocked_id: blocked_id!, created_at: now })));
  mkdirSync('docs/images', { recursive: true });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 850 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.port}`;
  await page.goto(`${base}/projects/offline-reading-1`);
  await page.locator('[data-testid="node-GF-8"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('graph-tile').getByRole('button', { name: 'fit', exact: true }).click();
  await page.getByTestId('node-GF-7').focus();
  await page.screenshot({ path: 'docs/images/project.png', animations: 'disabled' });
  await page.getByTestId('graph-tile').getByRole('button', { name: 'expand', exact: true }).click();
  const graph = page.getByRole('dialog', { name: 'dependency graph' });
  await graph.waitFor();
  await graph.getByRole('button', { name: 'fit', exact: true }).click();
  await graph.getByRole('button', { name: 'zoom in', exact: true }).click();
  await graph.getByRole('button', { name: 'zoom in', exact: true }).click();
  await graph.getByTestId('node-GF-7').focus();
  await page.screenshot({ path: 'docs/images/dependency-graph.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 460 });
  await page.goto(`${base}/?project_id=1`);
  await page.getByText('Explore reading themes', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/images/board.png', animations: 'disabled' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Captured project, expanded dependency graph, and board with synthetic data.');
} finally {
  await browser?.close();
  server.stop(true);
  handle.close();
  rmSync(dir, { recursive: true, force: true });
}
