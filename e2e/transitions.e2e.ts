import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 04's exit criterion: the lifecycle by drag and by button, and the
 * approve guard refusing in words. Named to sort after `tickets.e2e.ts` —
 * one worker shares one database, and that spec addresses `GF-1` by name.
 */

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });

/** A ticket from the board, opened; the state tile is what the rest of the test drives. */
async function newTicket(page: Page, title: string) {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  await page.getByTestId('board-create').getByLabel('ticket title').fill(title);
  await page.getByTestId('board-create').getByLabel('ticket title').press('ControlOrMeta+Enter');
  await expect(card(page, title)).toBeVisible();
}

test('a card drags from backlog to todo, and review refuses a drop back into building', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  await page.getByTestId('new-app-form').getByLabel('name').fill('Lifecycle');
  await page.getByTestId('new-app-form').getByLabel('name').press('ControlOrMeta+Enter');

  await newTicket(page, 'Drag me across');
  await card(page, 'Drag me across').dragTo(page.getByTestId('col-todo'));
  await expect(page.getByTestId('col-todo')).toContainText('Drag me across');
  await expect(page.getByTestId('col-backlog')).not.toContainText('Drag me across');

  // walk it to review with the state tile's buttons, which read the same table
  await card(page, 'Drag me across').click();
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.getByTestId('app-select').selectOption({ label: 'Lifecycle' });
  await page.getByTestId('simple-toggle').click();
  await expect(page.getByTestId('simple-toggle')).toBeChecked(); // the toggle follows the ticket, so wait for the write to land
  for (const name of ['approve', 'start', 'submit']) await page.getByTestId(`move-${name}`).click();
  await expect(page.getByTestId('state-tile')).toContainText('review');

  // there is no review → building arrow: the drop is refused in words and the card snaps back
  await page.goto('/');
  await expect(page.getByTestId('col-review')).toContainText('Drag me across');
  await card(page, 'Drag me across').dragTo(page.getByTestId('col-building'));
  await expect(page.getByTestId('refusal-building')).toHaveText('a ticket in review does not go back to building');
  await expect(page.getByTestId('col-review')).toContainText('Drag me across');
  await expect(page.getByTestId('col-building')).not.toContainText('Drag me across');

  // the move that happened is history as a decision, not only as a state
  await card(page, 'Drag me across').click();
  await expect(page.getByTestId('history')).toContainText('submitted · building → review');
  await expect(page.getByTestId('history')).toContainText('picked · backlog → todo');
});

test('approve names what the ticket is missing, and simple is what lets it through', async ({ page }) => {
  await newTicket(page, 'Needs a plan');
  await card(page, 'Needs a plan').click();
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.getByTestId('app-select').selectOption({ label: 'Lifecycle' });
  await page.getByTestId('move-pick').click();

  await page.getByTestId('move-approve').click();
  await expect(page.getByTestId('state-refusal')).toHaveText('approve needs a ticket design');
  await expect(page.getByTestId('state-tile')).toContainText('todo');

  await page.getByTestId('simple-toggle').click();
  await expect(page.getByTestId('simple-toggle')).toBeChecked();
  await page.getByTestId('move-approve').click();
  await expect(page.getByTestId('state-tile')).toContainText('ready');
  await page.goto('/');
  await expect(page.getByTestId('col-ready')).toContainText('Needs a plan');
});

/** The board is one tile, so it spans the desk: at laptop width and up every column is on screen, `done` included (DESIGN.md Layout). */
test('a closed ticket shows in the done column, and that column is on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await newTicket(page, 'Turned out to be done');
  await card(page, 'Turned out to be done').click();
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.getByTestId('move-close').click();
  await expect(page.getByTestId('state-tile')).toContainText('done');

  await page.goto('/');
  await expect(page.getByTestId('col-done')).toContainText('Turned out to be done');
  await expect(page.getByTestId('col-done')).toBeInViewport();
});
