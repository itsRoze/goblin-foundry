import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GF-132: Open terminal's modal from a card's menu, by finger, on a card the Cursor is not on. The
 * menu leaves the Cursor where it was (DESIGN.md Card menu), so every close leaves the focus where
 * the Cursor's keys are, as the Start modal's does (GF-131). Against a temporary Checkout, so a
 * Worktree can be made, with the `none` terminal step the e2e server runs.
 */

const mine = (title: string) => `${title} (${test.info().project.name})`;
let root = '';
let appId = 0;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
test.beforeAll(async ({ request }) => {
  // real, because git answers with where a folder actually is and macOS's temp dir is a symlink
  root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-touch-terminal-')));
  const repo = join(root, 'subway-reader');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
  const response = await request.post('/api/apps', { data: { name: `Terminal focus ${Date.now().toString(36)}`, checkout: repo } });
  appId = ((await response.json()) as { id: number }).id;
  expect((await request.patch('/api/settings', { data: { worktree_root: join(root, 'worktrees') } })).ok()).toBe(true);
});
test.afterAll(async ({ request }) => {
  rmSync(root, { recursive: true, force: true });
  // the database is shared, and the next spec reads the setting as a fresh installation has it
  expect((await request.patch('/api/settings', { data: { worktree_root: '~/.goblin/worktrees' } })).ok()).toBe(true);
  // and counts the live Apps: the bar is a phone wide only while that count has two digits (`touch-targets`)
  expect((await request.post(`/api/apps/${appId}/archive`)).ok()).toBe(true);
});
const modal = (page: Page) => page.getByTestId('start-modal');
const said = (page: Page) => page.getByTestId('terminal-said');

test('on the board Open terminal from a card the Cursor is not on leaves the focus with the Cursor, on every close', async ({ page }) => {
  // both engines run over one database, so the Filter names this engine's cards alone
  const word = mine('Taptermcursal');
  const res = await page.request.post('/api/tickets', { data: { title: `${word} cursor`, status: 'planning', simple: true } });
  const cursorKey = ((await res.json()) as { key: string }).key;
  const cursorCard = page.getByTestId(`card-${cursorKey}`);
  // in flight with no Worktree recorded, as an agent's Start leaves it
  const made = await page.request.post('/api/tickets', { data: { title: `${word} menu`, status: 'ready', simple: true, app_id: appId } });
  const key = ((await made.json()) as { key: string }).key;
  expect((await page.request.post(`/api/tickets/${key}/start`)).status()).toBe(200);
  await page.goto(`/?q=${encodeURIComponent(word)}`);
  await expect(cursorCard).toBeVisible();
  await page.keyboard.press('j');
  await expect(cursorCard).toHaveAttribute('aria-current', 'true');
  const withCursor = async (close: string) => {
    await expect(modal(page), close).toHaveCount(0);
    await expect(page.locator('body'), close).toBeFocused();
    await expect(cursorCard, close).toHaveAttribute('aria-current', 'true');
    await expect(cursorCard, close).toBeInViewport();
  };
  const open = async () => {
    await page.getByTestId(`menu-${key}`).tap();
    await page.getByTestId(`menu-${key}-terminal`).tap();
    await expect(modal(page).getByLabel('branch')).toBeFocused();
  };

  await open();
  await modal(page).getByTestId('start-cancel').tap();
  await withCursor('cancel');
  await open();
  await page.keyboard.press('Escape');
  await withCursor('esc');
  await open();
  const { height } = page.viewportSize()!;
  await page.touchscreen.tap(8, height - 8);
  await withCursor('a tap outside');
  // the Checkout itself is on `main`, so git refuses it, and the refusal stays until `esc`
  await open();
  await modal(page).getByLabel('branch').fill('main');
  await modal(page).getByTestId('start-go').tap();
  await expect(modal(page).getByRole('alert')).toBeVisible();
  // a finger's typing opens no list, so the first `esc` is the modal's
  await expect(modal(page).getByRole('listbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await withCursor('a refusal, then esc');

  // a Worktree made and a terminal not opened: the folder is the way forward, so its copy has the focus, and keeps it
  await open();
  await modal(page).getByTestId('start-go').tap();
  await expect(modal(page)).toHaveCount(0);
  await expect(said(page).getByRole('button', { name: 'copy folder of this terminal' })).toBeFocused();
  // and once the line goes, the focus does not go to the card it was about
  await page.keyboard.press('Escape');
  await expect(said(page)).toHaveCount(0);
  await withCursor('the line let go');
  // the Cursor's `⏎` opens the Cursor's Ticket
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tickets/${cursorKey}$`));
});
