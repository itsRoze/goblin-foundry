import { expect, test, type Page } from '@playwright/test';

/**
 * GF-54's exit criterion: a card wears its Labels as plain chips behind a View
 * option, and `label` is a set in the address the Filter bar's chip writes.
 * Seeded through the API, because the Ticket view's own label editing is not
 * what this spec is about.
 */
const seed = async (page: Page, title: string, labels: string[]) =>
  (await (await page.request.post('/api/tickets', { data: { title, labels } })).json()) as { key: string };

test('labels on the board: a card chip behind a view option, and the label filter in the address', async ({ page }) => {
  const asks = await seed(page, 'Labelled: asks a question', ['needs-info']);
  const research = await seed(page, 'Labelled: a research decision', ['wayfinder:research']);
  const plain = await seed(page, 'Labelled: nothing to say', []);

  // either name lets a ticket on, and the address survives a reload as it was written
  await page.goto('/?label=needs-info,wayfinder:research');
  const card = (t: { key: string }) => page.getByTestId(`card-${t.key}`);
  await expect(card(asks)).toBeVisible();
  await expect(card(research)).toBeVisible();
  await expect(card(plain)).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/\?label=needs-info,wayfinder:research$/);
  await expect(card(research)).toBeVisible();
  await expect(page.getByTestId('chip-label')).toContainText('needs-info, wayfinder:research');

  // the card's chip, and the View option that takes it away
  await expect(page.getByTestId(`card-labels-${asks.key}`)).toHaveText('needs-info');
  await page.keyboard.press('v');
  await page.getByTestId('view-menu').getByLabel('labels').click();
  await expect(page.getByTestId(`card-labels-${asks.key}`)).toHaveCount(0);
  await page.getByTestId('view-menu').getByLabel('labels').click();
  await expect(page.getByTestId(`card-labels-${asks.key}`)).toHaveText('needs-info');
  await page.keyboard.press('Escape');

  // the chip's popover sets and clears the set; the box is answered by the address, so the click and the assertion are separate (docs/LESSONS.md)
  await page.getByTestId('chip-label').click();
  await page.getByTestId('check-label-wayfinder:research').click();
  await expect(page).toHaveURL(/\/\?label=needs-info$/);
  await expect(card(research)).toHaveCount(0);
  await page.getByTestId('check-label-needs-info').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(plain)).toBeVisible();
  await page.getByTestId('check-label-needs-info').click();
  await expect(page).toHaveURL(/\/\?label=needs-info$/);
  await page.keyboard.press('Escape');

  // a name the Piece refuses is shown as pasted, struck, with the refusal under the bar
  await page.goto('/?label=needs%20info');
  await expect(page.getByTestId('filter-refusal')).toContainText('needs info is not one word');
  await expect(page.getByTestId('chip-label')).toContainText('needs info');
  await expect(page.getByTestId('chip-label')).toHaveClass(/is-bad/);
});
