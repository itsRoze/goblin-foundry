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
 * never scrolls sideways, and the kanban does its scrolling inside its own tile
 * where it is a kanban — and stacks where there is no room for one (issue 11).
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

/** The ticket's five (390 · 768 · 1440 · 1920 · 2560) and the tiers' edges either side of them. */
const WIDTHS = [375, 390, 600, 768, 900, 1200, 1440, 1920, 2560, 3440];

/** Every routine page, including the ticket view — the densest tile in the app. */
const ROUTES = ['/', '/apps', '/projects', '/settings', '/trash'];

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
  const ticketPath = new URL((await card.getAttribute('href')) ?? '', 'http://x').pathname;
  // and an app, so the App view — a page of four tiles — is measured too
  const app = await page.request.post('/api/apps', { data: { name: 'Measured' } }).then((r) => r.json() as Promise<{ id: number }>);
  const appPath = `/apps/measured-${app.id}`;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [...ROUTES, ticketPath, appPath]) {
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

/**
 * The board's orientation is its own width's decision (issue 11): a phone gets
 * sections down the page, a tablet keeps the kanban and scrolls it inside the
 * tile, and an ultrawide's columns stop growing. Either side of the breakpoint
 * is checked, not only the far ends.
 */
test('the board stacks where the columns would be cramped, and keeps the kanban inside its tile where they are not', async ({ page }) => {
  const orientation = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="board"]');
    return page.evaluate(() => {
      const board = document.querySelector<HTMLElement>('[data-testid="board"]')!;
      return {
        orientation: board.dataset.orientation,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollsInside: board.scrollWidth > board.clientWidth,
        workspaceLabelsHidden: getComputedStyle(document.querySelector('.gf-ws-label')!).display === 'none',
      };
    });
  };

  // a phone: stacked, nothing scrolls sideways at all — the page scrolls down instead
  expect(await orientation(390)).toEqual({ orientation: 'vertical', pageOverflow: 0, scrollsInside: false, workspaceLabelsHidden: true });
  await expect(page.getByTestId('section-planning')).toBeVisible();
  await expect(page.locator('.gf-cols')).toHaveCount(0);
  // the ways out of the board are never among the words the bar drops
  await expect(page.getByRole('link', { name: 'trash' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'settings' })).toBeVisible();

  // and still nothing sideways with a card's menu open (LESSONS 2026-09-16)
  await page.request.post('/api/tickets', { data: { title: 'Menu measured', status: 'planning' } });
  await page.goto('/?q=Menu%20measured');
  await page.locator('[data-testid^="menu-GF-"]').first().click();
  await expect(page.locator('[data-testid^="card-menu-GF-"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  // just under the breakpoint and just over it
  expect((await orientation(680)).orientation).toBe('vertical');
  expect((await orientation(720)).orientation).toBe('horizontal');

  // a tablet: the kanban, scrolling inside its tile and never the page
  expect(await orientation(768)).toEqual({ orientation: 'horizontal', pageOverflow: 0, scrollsInside: true, workspaceLabelsHidden: true });
  await expect(page.getByTestId('col-backlog')).toBeVisible();

  // a resized window changes its mind without a reload
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'vertical');
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'horizontal');

  // wide enough that eight columns fit with room to spare: they must stop, not stretch
  await page.setViewportSize({ width: 2560, height: 900 });
  await page.goto('/');
  await page.waitForSelector('.gf-col');
  const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.gf-col')].map((c) => c.getBoundingClientRect().width)));
  expect(widest).toBeLessThanOrEqual(280);
});
