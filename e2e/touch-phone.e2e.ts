import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 11 by finger alone: every S1 workflow on a phone-sized screen under
 * touch emulation, in both engines (`playwright.config.ts`: Chromium for
 * Android Chrome, WebKit for iOS Safari). Nothing here presses `esc`, `⌘⏎` or
 * a letter key: what a keyboard reaches, a tap must reach by a visible control.
 * Emulation is not a device — a real software keyboard and a real long-press
 * are reported separately in the ticket.
 */

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });

/** Both engines run over one database, so what each makes is named for the engine that made it. */
const mine = (title: string) => `${title} (${test.info().project.name})`;

async function seed(page: Page, title: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await page.request.post('/api/tickets', { data: { title, ...body } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { key: string }).key;
}

test('create, cancel, submit and open a ticket by tapping', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'vertical');

  // the `c new` hint is the control: tap it, and the row has its own cancel and save
  await page.getByTestId('hint-new').tap();
  const row = page.getByTestId('board-create');
  await expect(row).toBeVisible();
  await row.getByLabel('ticket title').fill(mine('Not this one'));
  await row.getByTestId('form-cancel').tap();
  await expect(row).toHaveCount(0);

  await page.getByTestId('hint-new').tap();
  await row.getByLabel('ticket title').fill(mine('Made by tapping'));
  // the focused field and the way to finish are both on screen
  await expect(row.getByLabel('ticket title')).toBeFocused();
  await expect(row.getByTestId('form-save')).toBeInViewport();
  await row.getByTestId('form-save').tap();
  await expect(row).toHaveCount(0);

  // it landed in backlog, which is folded: the heading opens it, and the card opens the ticket
  await page.getByTestId('section-head-backlog').tap();
  await card(page, mine('Made by tapping')).tap();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await expect(page.getByTestId('page-title')).toContainText(mine('Made by tapping'));
  // put the fold back so the next test meets the default
  await page.goto('/');
  await page.getByTestId('section-head-backlog').tap();
  await expect(page.getByTestId('section-head-backlog')).toHaveAttribute('aria-expanded', 'false');
});

test('a description, a title, a design and a link are all edited and finished by tapping', async ({ page }) => {
  const key = await seed(page, mine('Written by tapping'));
  await page.goto(`/tickets/${key}`);
  await expect(page.getByTestId('about-tile')).toBeVisible();

  // `e write` as a control puts the caret in the description; `done` on the mode line lets go
  await page.getByTestId('hint-write').tap();
  const description = page.getByTestId('description').locator('.gf-doc');
  await expect(description).toBeFocused();
  await page.keyboard.type('what it is for');
  await expect(page.getByTestId('editor-done')).toBeInViewport();
  await page.getByTestId('editor-done').tap();
  await expect(page.getByTestId('about-tile').getByTestId('saving')).toHaveText('saved');
  await expect(page.getByTestId('about-tile').getByTestId('mode-line')).toHaveCount(0);

  // the title has a save and a cancel of its own
  await page.getByTestId('ticket-title').tap();
  await page.getByLabel('title').fill('Retitled by tapping');
  await page.getByTestId('title-save').tap();
  await expect(page.getByTestId('page-title')).toContainText('Retitled by tapping');
  await page.getByTestId('ticket-title').tap();
  await page.getByLabel('title').fill('Not this title');
  await page.getByTestId('title-cancel').tap();
  await expect(page.getByTestId('page-title')).toContainText('Retitled by tapping');

  // the design: a link cancelled leaves the words as they were and the caret in the field; applied, it lands
  const tile = page.getByTestId('design-tile');
  const design = tile.locator('.gf-doc');
  await design.tap();
  await page.keyboard.type('the planner');
  await page.keyboard.press('ControlOrMeta+A');
  await tile.getByTestId('fmt-link').tap();
  await tile.getByLabel('link url').fill('https://nope.dev');
  await tile.getByTestId('link-cancel').tap();
  await expect(tile.getByLabel('link url')).toHaveCount(0);
  await expect(design.locator('a')).toHaveCount(0);
  await expect(design).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await tile.getByTestId('fmt-link').tap();
  await tile.getByLabel('link url').fill('https://goblin.dev');
  await tile.getByTestId('link-apply').tap();
  await expect(design.locator('a')).toHaveAttribute('href', 'https://goblin.dev');
  await tile.getByTestId('editor-done').tap();
  await expect(tile.getByTestId('saving')).toHaveText('saved');

  // with the screen shortened the way a software keyboard shortens it, the field and its `done` can still be brought on screen together
  await page.setViewportSize({ width: 390, height: 320 });
  await design.tap();
  await tile.getByTestId('mode-line').scrollIntoViewIfNeeded();
  await expect(tile.getByTestId('editor-done')).toBeInViewport();
  await expect(design).toBeInViewport();
});

test('a dependency is declared and removed by tapping, and the picker is dismissed by its own close', async ({ page }) => {
  const blocker = await seed(page, mine('Tapped blocker'));
  const blocked = await seed(page, mine('Tapped dependent'));
  await page.goto(`/tickets/${blocked}`);
  await expect(page.getByTestId('dependencies-tile')).toBeVisible();

  await page.getByTestId('add-depends_on').tap();
  await expect(page.getByTestId('picker-depends_on')).toBeVisible();
  await page.getByTestId('add-depends_on').tap(); // `close`, on the same control
  await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);

  await page.getByTestId('add-depends_on').tap();
  await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill(mine('Tapped blocker'));
  await page.getByTestId(`pick-${blocker}`).tap();
  await expect(page.getByTestId('deps-depends_on')).toContainText(mine('Tapped blocker'));
  await page.getByTestId('deps-depends_on').getByRole('button', { name: `remove ${blocker}` }).tap();
  await expect(page.getByTestId('deps-depends_on')).toContainText('nothing in the way');
});

test('settings, the trash, the palette and a card menu are all reached and left by tapping', async ({ page }) => {
  const key = await seed(page, mine('Menu by tapping'), { status: 'planning' });
  await page.goto(`/?q=${encodeURIComponent(mine('Menu by tapping'))}`);
  await expect(card(page, mine('Menu by tapping'))).toBeVisible();

  // a menu opens on its card and closes on a tap anywhere else — no `esc` needed
  await page.getByTestId(`menu-${key}`).tap();
  const menu = page.getByTestId(`card-menu-${key}`);
  await expect(menu).toBeVisible();
  await expect(menu).toBeInViewport();
  await page.getByTestId('board-tile').locator('.gf-tile-head').tap();
  await expect(menu).toHaveCount(0);
  // and a row in it moves the card it hangs off
  await page.getByTestId(`menu-${key}`).tap();
  await page.getByTestId(`menu-${key}-approve`).tap();
  await expect(page.getByTestId('refusal-planning')).toContainText('approve needs');

  // the filter chips and `f find` are reached by finger; a chip's popover closes on a tap outside it
  await page.getByTestId('chip-status').tap();
  await expect(page.getByTestId('pop-status')).toBeVisible();
  await expect(page.getByTestId('pop-status')).toBeInViewport();
  await page.getByTestId('board-tile').locator('.gf-tile-head').tap();
  await expect(page.getByTestId('pop-status')).toHaveCount(0);
  await page.getByTestId('hint-find').tap();
  await expect(page.getByLabel('filter by text')).toBeFocused();
  await page.getByTestId('board-tile').locator('.gf-tile-head').tap();

  // the view options open from their hint and close from their own `×`
  await page.getByTestId('hint-view').tap();
  await expect(page.getByTestId('view-menu')).toBeVisible();
  await page.getByRole('button', { name: 'close view options' }).tap();
  await expect(page.getByTestId('view-menu')).toHaveCount(0);

  // the palette from the bar's `⌘K`, and away again with a tap outside it
  await page.getByTestId('open-palette').tap();
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect(page.getByTestId('palette')).toBeInViewport();
  // the panel covers the top of the screen; a tap on the page below it is a tap outside
  const screen = page.viewportSize()!;
  await page.touchscreen.tap(screen.width / 2, screen.height - 24);
  await expect(page.getByTestId('palette')).toHaveCount(0);

  // the bar's links are the way to the pages it names
  await page.getByRole('link', { name: 'settings' }).tap();
  await expect(page.getByTestId('settings-tile')).toBeVisible();
  await page.getByTestId('hint-edit').tap();
  await expect(page.getByTestId('settings-form')).toBeVisible();
  await page.getByTestId('settings-form').getByRole('button', { name: /cancel/ }).tap();
  await expect(page.getByTestId('settings-form')).toHaveCount(0);
  await page.getByRole('link', { name: 'trash' }).tap();
  await expect(page.getByTestId('trash-tickets-tile')).toBeVisible();
  await page.getByRole('link', { name: '1' }).tap();
  await expect(page.getByTestId('board')).toBeVisible();
});

test('a long title, an empty section and a menu at the foot of a short screen all stay on screen', async ({ page }) => {
  const long = mine('A title that runs to a full sentence and then some, because real work is named by people who never think about the width of a card');
  const key = await seed(page, long, { status: 'planning' });
  await page.goto(`/?q=${encodeURIComponent(long)}`);
  await expect(page.getByTestId(`card-${key}`)).toBeVisible();

  // nothing scrolls sideways, with or without the menu open, and the empty sections still say what they hold
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBe(0);
  await expect(page.getByTestId('section-head-ready')).toContainText('0');
  await page.getByTestId(`menu-${key}`).tap();
  await expect(page.getByTestId(`card-menu-${key}`)).toBeVisible();
  expect(await overflow()).toBe(0);
  await page.getByTestId('board-tile').locator('.gf-tile-head').tap();

  // a short screen with the card at its foot: the menu hangs above the card rather than off the screen
  await page.setViewportSize({ width: 390, height: 300 });
  await page.getByTestId(`menu-${key}`).scrollIntoViewIfNeeded();
  await page.evaluate((k) => document.querySelector(`.gf-card[data-key="${k}"]`)?.scrollIntoView({ block: 'start' }), key);
  await page.getByTestId(`menu-${key}`).tap();
  await expect(page.getByTestId(`card-menu-${key}`)).toBeVisible();
  await expect(page.getByTestId(`menu-${key}-approve`)).toBeInViewport();
});
