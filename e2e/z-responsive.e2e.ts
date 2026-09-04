import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * DESIGN.md Layout as an executable check.
 *
 * What Layout actually asks for is a *tile width*: "more tiles open ... rather than
 * the same tiles getting bigger". Asserting the column count instead would only
 * restate the media queries — any edit that kept `app.css` and this file in step
 * would pass by construction, which is no test at all. So the tiers are checked
 * by their consequence: a tile stays in a readable band at every width, the page
 * never scrolls sideways, and the kanban does its scrolling inside its own tile.
 */

/**
 * The band a tile has to stay inside *once the grid applies*. Below 1440 Layout asks
 * for a single column, so a tile there is as wide as the window — at 1200px that
 * is 1176px, wider than any grid tier produces. That is the spec's own choice
 * ("The tile grid appears at ≥1440"), not a regression, so the width check
 * starts where the grid does and the narrow range is checked for overflow only.
 */
const GRID_FROM = 1440;
const NARROWEST = 300;
const WIDEST = 900;

const WIDTHS = [375, 600, 900, 1200, 1440, 1920, 2560, 3440];

/** Every routine page, including the ticket view — the densest tile in the app. */
const ROUTES = ['/', '/apps', '/projects'];

const measure = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    // the board spans the desk on purpose (eight statuses need the room), so it is
    // measured by its columns instead — see the kanban test below
    const tiles = [...document.querySelectorAll('.gf-tile:not(.is-span)')].map((t) => Math.round(t.getBoundingClientRect().width));
    return { overflow: doc.scrollWidth - doc.clientWidth, tiles };
  });

test('no page scrolls sideways, and a tile never stretches past reading width', async ({ page }) => {
  // a ticket of this suite's own, so the ticket view has something to render whatever ran before
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  const form = page.getByTestId('board-create');
  await form.getByLabel('ticket title').fill('A ticket to measure');
  await form.getByLabel('ticket title').press('ControlOrMeta+Enter');
  const card = page.locator('[data-testid^="card-"]', { hasText: 'A ticket to measure' });
  await expect(card).toBeVisible();
  const ticketPath = new URL(await card.getAttribute('href') ?? '', 'http://x').pathname;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [...ROUTES, ticketPath]) {
      await page.goto(route);
      await page.waitForSelector('.gf-desk .gf-tile');
      const { overflow, tiles } = await measure(page);
      expect(overflow, `${route} at ${width}px scrolls sideways`).toBe(0);
      if (width < GRID_FROM) continue;
      for (const tile of tiles) {
        expect(tile, `a tile at ${width}px is ${tile}px wide`).toBeLessThanOrEqual(WIDEST);
        expect(tile, `a tile at ${width}px is ${tile}px wide`).toBeGreaterThanOrEqual(NARROWEST);
      }
    }
  }
});

test('the kanban scrolls inside its tile rather than the page, and its columns stop growing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  await page.waitForSelector('.gf-cols');
  const narrow = await page.evaluate(() => {
    const cols = document.querySelector('.gf-cols')!;
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      kanbanScrollsInside: cols.scrollWidth > cols.clientWidth,
      workspaceLabelsHidden: getComputedStyle(document.querySelector('.gf-ws-label')!).display === 'none',
    };
  });
  expect(narrow).toEqual({ pageOverflow: 0, kanbanScrollsInside: true, workspaceLabelsHidden: true });
  // the ways out of the board are never among the words the bar drops
  await expect(page.getByRole('link', { name: 'trash' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'settings' })).toBeVisible();

  // wide enough that eight columns fit with room to spare: they must stop, not stretch
  await page.setViewportSize({ width: 2560, height: 900 });
  await page.goto('/');
  await page.waitForSelector('.gf-col');
  const widest = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll('.gf-col')].map((c) => c.getBoundingClientRect().width)),
  );
  expect(widest).toBeLessThanOrEqual(280);
});
