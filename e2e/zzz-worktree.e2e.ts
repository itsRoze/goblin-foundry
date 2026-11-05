import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Named to run after the desktop specs, whose app lists this App would crowd. */
test.describe("a Ticket's Worktree", () => {
  let root: string;
  let repo: string;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

  test.beforeAll(() => {
    // real, because git answers with where a folder actually is and macOS's temp dir is a symlink
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-worktree-')));
    repo = join(root, 'subway-reader');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
  });
  test.afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('the Worktree root is edited where the prefix is, and the prefix stays what it was', async ({ page }) => {
    await page.goto('/settings');
    const tile = page.getByTestId('settings-tile');
    await expect(tile.getByTestId('worktree-root')).toHaveText('~/.goblin/worktrees');
    await expect(tile.getByTestId('ticket-prefix')).toHaveText('GF');

    await page.keyboard.press('e');
    const form = page.getByTestId('settings-form');
    const field = form.getByLabel('worktree root');
    await expect(field).toHaveValue('~/.goblin/worktrees');

    // a relative folder is refused where it was typed
    await field.fill('worktrees');
    await form.getByRole('button', { name: /save/ }).click();
    await expect(form.getByRole('alert')).toHaveText('worktree_root: an absolute folder, or one under ~');

    const chosen = join(root, 'worktrees');
    await field.fill(chosen);
    await form.getByRole('button', { name: /save/ }).click();
    await expect(form).toBeHidden();
    await expect(tile.getByTestId('worktree-root')).toHaveText(chosen);
    await expect(tile.getByTestId('ticket-prefix')).toHaveText('GF');
    expect(await (await page.request.get('/api/settings')).json()).toEqual({ ticket_prefix: 'GF', worktree_root: chosen, terminal_step: 'none' });
  });

  test('a started Ticket shows its branch and folder, copies the folder, and the history says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    expect((await page.request.patch('/api/settings', { data: { worktree_root: join(root, 'worktrees') } })).ok()).toBe(true);
    const app = (await (await page.request.post('/api/apps', { data: { name: 'Subway Worktrees', checkout: repo } })).json()) as { id: number };
    const ticket = (await (await page.request.post('/api/tickets', { data: { title: 'Parse the feed', app_id: app.id, status: 'ready', simple: true } })).json()) as { key: string };

    await page.goto(`/tickets/${ticket.key}`);
    const panel = page.getByTestId('implementation-tile');
    // nothing to show until it has a place, and the suggestion is still there either way
    await expect(panel.getByTestId('worktree-folder')).toHaveCount(0);
    await expect(panel.getByTestId('branch-name')).toBeVisible();

    const branch = `${ticket.key.toLowerCase()}-parse-the-feed`;
    const folder = join(root, 'worktrees', 'subway-reader', 'mine-here');
    const started = await page.request.post(`/api/tickets/${ticket.key}/start`, { data: { branch: 'mine/here' } });
    expect(started.status()).toBe(200);
    await page.reload();
    await expect(panel.getByTestId('worktree-branch')).toHaveText('mine/here');
    await expect(panel.getByTestId('worktree-folder')).toHaveText(folder);
    await expect(panel.getByTestId('branch-name')).toHaveText(branch);

    const copy = panel.getByRole('button', { name: 'copy folder of this worktree' });
    await expect(copy).toHaveText('copy folder');
    await copy.click();
    await expect(copy).toHaveText('copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(folder);

    await expect(page.getByTestId('history').locator('li').first()).toContainText('started · ready → building · worktree mine/here');
  });

  test('a clipboard that refuses never claims the folder was copied', async ({ page }) => {
    expect((await page.request.patch('/api/settings', { data: { worktree_root: join(root, 'worktrees') } })).ok()).toBe(true);
    const app = (await (await page.request.post('/api/apps', { data: { name: 'Subway Blocked', checkout: repo } })).json()) as { id: number };
    const ticket = (await (await page.request.post('/api/tickets', { data: { title: 'Blocked clipboard', app_id: app.id, status: 'ready', simple: true } })).json()) as { key: string };
    expect((await page.request.post(`/api/tickets/${ticket.key}/start`, { data: {} })).status()).toBe(200);
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }));
    await page.goto(`/tickets/${ticket.key}`);
    const panel = page.getByTestId('implementation-tile');
    const copy = panel.getByRole('button', { name: 'copy folder of this worktree' });
    await copy.click();
    await expect(panel.getByRole('alert')).toContainText('Select the folder above');
    await expect(copy).toHaveText('copy folder');
  });
});
