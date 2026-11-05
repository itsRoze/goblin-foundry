import { expect, test, type Page } from '@playwright/test';

/**
 * GF-131: where the focus goes when the Start modal closes, in the engine whose tap focuses no
 * button, so the modal cannot learn where it came from by asking the page what has the focus.
 * An App with no Checkout, so the Start is the plain one and asks for no terminal: a terminal
 * that did not open would take the focus to its `copy folder` instead.
 */

const mine = (title: string) => `${title} (${test.info().project.name})`;
let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: `Start focus ${Date.now().toString(36)}` } });
  appId = ((await response.json()) as { id: number }).id;
});
const ready = async (page: Page, title: string) => {
  const res = await page.request.post('/api/tickets', { data: { title: mine(title), status: 'ready', simple: true, app_id: appId } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { key: string }).key;
};
const modal = (page: Page) => page.getByTestId('start-modal');

test('on the Ticket view a cancel hands the focus back to start, in Tab’s order, and a Start to open terminal', async ({ page }) => {
  const key = await ready(page, 'Tapfocal view');
  await page.goto(`/tickets/${key}`);
  const start = page.getByTestId('move-start');
  await start.tap();
  await modal(page).getByTestId('start-cancel').tap();
  await expect(modal(page)).toHaveCount(0);
  await expect(start).toBeFocused();
  // a tap outside the panel is a cancel too, and that tap's own focus change must not take the focus back off `start`
  await start.tap();
  await expect(modal(page).getByTestId('start-cancel')).toBeVisible();
  const { height } = page.viewportSize()!;
  await page.touchscreen.tap(8, height - 8);
  await expect(modal(page)).toHaveCount(0);
  await expect(start).toBeFocused();
  // a phone or tablet with a keyboard: WebKit's Tab passes over a button with no tabindex
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(start).toBeFocused();

  await start.tap();
  await modal(page).getByTestId('start-plain').tap();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByTestId('open-terminal')).toBeFocused();
});

test('on the board a cancel from the card’s menu hands the focus to the card, and a Start to the card in building', async ({ page }) => {
  // a coined word: `?q=` is a substring over every earlier spec's tickets (LESSONS 2026-09-17)
  const title = 'Tapfocal board';
  const key = await ready(page, title);
  await page.goto(`/?q=${encodeURIComponent(mine(title))}`);
  const card = page.getByTestId(`card-${key}`);
  await page.getByTestId(`menu-${key}`).tap();
  await page.getByTestId(`menu-${key}-start`).tap();
  await modal(page).getByTestId('start-cancel').tap();
  await expect(modal(page)).toHaveCount(0);
  await expect(card).toBeFocused();

  await page.getByTestId(`menu-${key}`).tap();
  await page.getByTestId(`menu-${key}-start`).tap();
  await modal(page).getByTestId('start-plain').tap();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByTestId('section-building').getByTestId(`card-${key}`)).toBeFocused();
});
