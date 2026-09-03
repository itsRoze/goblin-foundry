import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 05's exit criterion: declare a blocker, see the card struck through on
 * the board, ship the blocker and watch it clear. Prefixed to sort after
 * `transitions.e2e.ts` — one worker shares one database, and the earlier specs
 * count tickets and address `GF-1` by name.
 */

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });

async function newTicket(page: Page, title: string) {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  const form = page.getByTestId('new-ticket');
  await form.getByLabel('ticket title').fill(title);
  await form.getByLabel('ticket title').press('ControlOrMeta+Enter');
  await expect(card(page, title)).toBeVisible();
}

/** Give a ticket what the approve guard wants, so it can be walked to `done`. */
async function makeReady(page: Page, title: string, appName: string) {
  await card(page, title).click();
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.getByTestId('app-select').selectOption({ label: appName });
  await page.getByTestId('simple-toggle').click();
  await expect(page.getByTestId('simple-toggle')).toBeChecked();
}

test('a declared blocker strikes the card through, and shipping the blocker clears it', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  const form = page.getByTestId('new-app-form');
  await form.getByLabel('name').fill('Dependencies');
  await form.getByLabel('name').press('ControlOrMeta+Enter');

  await newTicket(page, 'The groundwork');
  await newTicket(page, 'The thing that waits');

  // declare it from the waiting ticket — the intent hangs off the blocked end (ADR-0004)
  await makeReady(page, 'The thing that waits', 'Dependencies');
  await page.getByTestId('add-depends_on').click();
  await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill('groundwork');
  await page.getByTestId('picker-depends_on').getByRole('option').filter({ hasText: 'The groundwork' }).click();
  await expect(page.getByTestId('deps-depends_on')).toContainText('The groundwork');
  await expect(page.getByTestId('history')).toContainText('blocked by GF-');

  // the board says so with the outline glyph and a struck title — never a colour (DESIGN.md Colors)
  await page.goto('/');
  await expect(card(page, 'The thing that waits')).toHaveClass(/is-blocked/);
  await expect(card(page, 'The thing that waits')).toContainText('◇');
  await expect(card(page, 'The groundwork')).not.toHaveClass(/is-blocked/);

  // approving and starting the blocked ticket is allowed — it just asks first (ADR-0009)
  await card(page, 'The thing that waits').click();
  for (const name of ['pick', 'approve']) await page.getByTestId(`move-${name}`).click();
  await page.getByTestId('move-start').click();
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await page.getByTestId('confirm-start-yes').click();
  await expect(page.getByTestId('state-tile')).toContainText('building');

  // ship the blocker and the strike goes: nothing is in the way any more
  await page.goto('/');
  await makeReady(page, 'The groundwork', 'Dependencies');
  for (const name of ['pick', 'approve', 'start', 'submit', 'ship']) await page.getByTestId(`move-${name}`).click();
  await expect(page.getByTestId('state-tile')).toContainText('done');

  await page.goto('/');
  await expect(card(page, 'The thing that waits')).not.toHaveClass(/is-blocked/);
  await expect(card(page, 'The thing that waits')).not.toContainText('◇');
});

test('the same edge can be declared from the blocking end, and the picker is driven by the keyboard', async ({ page }) => {
  await newTicket(page, 'The prerequisite');
  await newTicket(page, 'The dependent');

  // stand on the blocker and say what it holds up; the edge lands on the other ticket
  await card(page, 'The prerequisite').click();
  await page.getByTestId('add-blocks').click();
  await page.getByRole('combobox', { name: 'blocks — search tickets' }).fill('dependent');
  await page.getByRole('combobox', { name: 'blocks — search tickets' }).press('Enter');
  await expect(page.getByTestId('deps-blocks')).toContainText('The dependent');
  await expect(page.getByTestId('history')).toContainText('blocking GF-');

  // and it reads as "blocked by" from the other end — one fact, two ends
  await page.goto('/');
  await expect(card(page, 'The dependent')).toHaveClass(/is-blocked/);
  await card(page, 'The dependent').click();
  await expect(page.getByTestId('deps-depends_on')).toContainText('The prerequisite');

  // removing it from this end removes the same edge
  await page.getByTestId('deps-depends_on').getByRole('button', { name: /^remove GF-/ }).click();
  await expect(page.getByTestId('deps-depends_on')).toContainText('nothing in the way');
  await page.goto('/');
  await expect(card(page, 'The dependent')).not.toHaveClass(/is-blocked/);
});
