import { expect, test } from '@playwright/test';

/** Issue 03's exit criterion: a ticket from a title, on the board, edited, trashed and restored. */
test('a ticket through the GUI: c on the board, edit the title, view options, trash and restore', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();

  // c creates a ticket from a title alone; it lands in backlog
  await page.keyboard.press('c');
  await page.getByTestId('new-ticket').getByLabel('ticket title').fill('Article list screen');
  await page.getByTestId('new-ticket').getByLabel('ticket title').press('ControlOrMeta+Enter');
  const card = page.getByTestId('card-GF-1');
  await expect(page.getByTestId('col-backlog')).toContainText('Article list screen');
  await expect(card).toContainText('backlog');
  await expect(card).toContainText('—'); // an orphan has no app / project

  // open it and rename it; the edit shows up in the history
  await card.click();
  await expect(page).toHaveURL(/\/tickets\/GF-1$/);
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await page.getByTestId('ticket-title').click();
  await page.getByLabel('title').fill('Article list screen: e-ink pagination');
  await page.getByLabel('title').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('page-title')).toContainText('Article list screen: e-ink pagination');
  await expect(page.getByTestId('history').locator('li').first()).toContainText('renamed Article list screen → Article list screen: e-ink pagination');

  // a bare number resolves to the canonical key
  await page.goto('/tickets/1');
  await expect(page).toHaveURL(/\/tickets\/GF-1$/);

  // cancelled is a view option, not a filter: the column is hidden until you ask for it
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('col-cancelled')).toHaveCount(0);
  await page.keyboard.press('v');
  await page.getByLabel('show cancelled').check();
  await expect(page.getByTestId('col-cancelled')).toBeVisible();

  // trash from the ticket view with ⌘⌫, restore from /trash with r
  await page.getByTestId('card-GF-1').click();
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Backspace');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('board')).not.toContainText('GF-1');
  await page.goto('/trash');
  await expect(page.getByTestId('trash-ticket-1')).toContainText('GF-1 Article list screen: e-ink pagination');
  await page.keyboard.press('r');
  await expect(page.getByTestId('trash-tickets-tile')).toContainText('no tickets in the trash');
  await page.goto('/');
  await expect(page.getByTestId('col-backlog')).toContainText('Article list screen: e-ink pagination');
});

/** `c` creates in the scope you are looking at, and the App view's tickets tile lists what it made. */
test('a ticket created from an App view belongs to it, and can be moved out again', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  const form = page.getByTestId('new-app-form');
  await form.getByLabel('name').fill('Reader');
  await form.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('tickets-tile')).toBeVisible();

  await page.keyboard.press('c');
  await page.getByTestId('new-ticket').getByLabel('ticket title').fill('Feed fixture parser tests');
  await page.getByTestId('new-ticket').getByLabel('ticket title').press('ControlOrMeta+Enter');
  const rows = page.getByTestId('ticket-rows');
  await expect(rows).toContainText('Feed fixture parser tests');
  await expect(rows).toContainText('backlog');

  await rows.getByRole('link', { name: /Feed fixture parser tests/ }).click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await expect(page.getByTestId('crumb')).toContainText('Reader');

  // the app is a native select; taking it away leaves the ticket an idea with a home to find
  await page.getByTestId('app-select').selectOption('');
  await expect(page.getByTestId('history').locator('li').first()).toContainText('removed from app');
  await expect(page.getByTestId('page-title')).not.toContainText('Reader');
});
