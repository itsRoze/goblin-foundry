import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { contrast, type Rgb } from '../scripts/contrast';

/**
 * The text-safe rule (DESIGN.md Colors), read off the screen: the ratio of what is drawn against what it is drawn on.
 * web/test/contrast.test.ts holds the tokens; this holds the places, because a token cannot say that a row
 * steps up to a fill on hover (GF-40).
 */
const UNIQUE_SEARCH_TITLE = 'Legibund';

async function legibility(locator: Locator): Promise<number> {
  const { text, surface } = await locator.evaluate(async (element) => {
    // a hover or a drag's fill eases in, and the ratio that counts is where it lands
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
    const channels = (colour: string) => (colour.match(/[\d.]+/g) ?? []).map(Number);
    let node: Element | null = element;
    while (node && channels(getComputedStyle(node).backgroundColor)[3] === 0) node = node.parentElement;
    return { text: channels(getComputedStyle(element).color).slice(0, 3), surface: channels(getComputedStyle(node ?? document.body).backgroundColor).slice(0, 3) };
  });
  return contrast(text as unknown as Rgb, surface as unknown as Rgb);
}

let key = '';
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/tickets', { data: { title: UNIQUE_SEARCH_TITLE } });
  key = ((await response.json()) as { key: string }).key;
});

const openBoard = async (page: Page) => {
  await page.goto(`/?q=${UNIQUE_SEARCH_TITLE}`);
  await expect(page.getByTestId(`menu-${key}`)).toBeVisible();
};

test('the card menu keeps its words legible on the highlighted row', async ({ page }) => {
  await openBoard(page);
  await page.getByTestId(`menu-${key}`).click();
  for (const row of ['cancel', 'trash']) {
    await page.getByTestId(`menu-${key}-${row}`).hover();
    expect(await legibility(page.getByTestId(`menu-${key}-${row}`)), row).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByTestId(`menu-${key}-pick`).hover();
  expect(await legibility(page.getByTestId(`menu-${key}-pick`).locator('.gf-menu-note')), 'destination').toBeGreaterThanOrEqual(4.5);
});

test('trash in the selection bar is legible', async ({ page }) => {
  await openBoard(page);
  await page.getByTestId(`select-${key}`).click();
  expect(await legibility(page.getByTestId('bulk-trash'))).toBeGreaterThanOrEqual(4.5);
});

test('cancel on the state tile and the refusal under it are legible', async ({ page }) => {
  await page.goto(`/tickets/${key}`);
  expect(await legibility(page.getByTestId('move-cancel'))).toBeGreaterThanOrEqual(4.5);
  await page.getByTestId('move-pick').click();
  await page.getByTestId('move-approve').click();
  await expect(page.getByTestId('state-refusal')).toBeVisible();
  expect(await legibility(page.getByTestId('state-refusal'))).toBeGreaterThanOrEqual(4.5);
});

test('a refusal under the filter bar is legible', async ({ page }) => {
  await page.goto('/?status=nope');
  expect(await legibility(page.getByTestId('filter-refusal'))).toBeGreaterThanOrEqual(4.5);
});

test('the head of the column under a drag is legible', async ({ page }) => {
  await openBoard(page);
  const box = await page.getByTestId(`card-${key}`).boundingBox();
  const target = await page.getByTestId('col-planning').boundingBox();
  if (!box || !target) throw new Error('the card and the column are on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 8 });
  await expect(page.getByTestId('col-planning')).toHaveClass(/is-over/);
  const head = page.getByTestId('col-planning').locator('.gf-col-head');
  expect(await legibility(head), 'status').toBeGreaterThanOrEqual(4.5);
  expect(await legibility(head.locator('b')), 'count').toBeGreaterThanOrEqual(4.5);
  await page.mouse.up();
});
