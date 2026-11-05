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

test('on the board a cancel from the Cursor’s card’s menu hands the focus to the card, and a Start to the card in building', async ({ page }) => {
  // a coined word: `?q=` is a substring over every earlier spec's tickets (LESSONS 2026-09-17)
  const title = 'Tapfocal board';
  const key = await ready(page, title);
  await page.goto(`/?q=${encodeURIComponent(mine(title))}`);
  const card = page.getByTestId(`card-${key}`);
  // the card has the focus back only if it is the Cursor's; the menu does not move the Cursor (DESIGN.md Card menu)
  await expect(card).toBeVisible();
  await page.keyboard.press('j');
  await expect(card).toHaveAttribute('aria-current', 'true');
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

// GF-131 review: a card's menu leaves the Cursor where it was (DESIGN.md Card menu), so a Start from a card that is not
// the Cursor's leaves the focus where the Cursor's keys are, or `⏎` would open that card while `s` acts on the Cursor's
test('on the board a Start from a card the Cursor is not on leaves the focus with the Cursor, on every close', async ({ page }) => {
  // both engines run over one database, so the Filter names this engine's cards alone
  const word = mine('Tapcursal');
  const res = await page.request.post('/api/tickets', { data: { title: `${word} cursor`, status: 'planning', simple: true } });
  const cursorKey = ((await res.json()) as { key: string }).key;
  const cursorCard = page.getByTestId(`card-${cursorKey}`);
  const key = await ready(page, `${word} menu`);
  const refused = await ready(page, `${word} refused`);
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
  const open = async (on: string) => {
    await page.getByTestId(`menu-${on}`).tap();
    await page.getByTestId(`menu-${on}-start`).tap();
    await expect(modal(page).getByTestId('start-cancel')).toBeFocused();
  };

  await open(key);
  await modal(page).getByTestId('start-cancel').tap();
  await withCursor('cancel');
  await open(key);
  await page.keyboard.press('Escape');
  await withCursor('esc');
  await open(key);
  const { height } = page.viewportSize()!;
  await page.touchscreen.tap(8, height - 8);
  await withCursor('a tap outside');
  // started elsewhere while the modal was open, so this one is refused, and the refusal stays until `esc`
  await open(refused);
  expect((await page.request.post(`/api/tickets/${refused}/start`)).status()).toBe(200);
  await modal(page).getByTestId('start-plain').tap();
  await expect(modal(page).getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await withCursor('a refusal, then esc');
  await open(key);
  await modal(page).getByTestId('start-plain').tap();
  await expect(page.getByTestId('section-building').getByTestId(`card-${key}`)).toBeVisible();
  await withCursor('a Start that lands');
  // the Cursor's `⏎` opens the Cursor's Ticket
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tickets/${cursorKey}$`));
});

// GF-131 review: a key's Start that lands brings what takes the focus into view, as a key's cancel does; on a phone
// the state tile starts below the fold
test('a keyed Start that lands brings the focus on screen, on the Ticket view and on the board', async ({ page }) => {
  const key = await ready(page, 'Keyfocal view');
  await page.goto(`/tickets/${key}`);
  await expect(page.getByTestId('move-start')).toBeAttached();
  const keyedStart = async () => {
    await page.keyboard.press('s');
    await page.getByTestId('run-move-start').waitFor();
    await page.keyboard.press('Enter');
    await expect(modal(page).getByTestId('start-cancel')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(modal(page).getByTestId('start-plain')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
  };
  await keyedStart();
  await expect(page.getByTestId('open-terminal')).toBeFocused();
  await expect(page.getByTestId('open-terminal')).toBeInViewport();

  const title = 'Keyfocal board';
  const onBoard = await ready(page, title);
  await page.goto(`/?q=${encodeURIComponent(mine(title))}`);
  const card = page.getByTestId(`card-${onBoard}`);
  await expect(card).toBeVisible();
  await page.keyboard.press('j');
  await expect(card).toHaveAttribute('aria-current', 'true');
  await keyedStart();
  const moved = page.getByTestId('section-building').getByTestId(`card-${onBoard}`);
  await expect(moved).toBeFocused();
  await expect(moved).toBeInViewport();
});
