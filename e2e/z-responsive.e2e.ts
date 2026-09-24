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

/** Once two useful tiles fit, a wider window opens more panels. */
const GRID_FROM = 876;
const NARROWEST = 300;
const WIDEST = 900;

/** The ticket's five (390 · 768 · 1440 · 1920 · 2560) and the tiers' edges either side of them. */
const WIDTHS = [375, 390, 600, 768, 875, 876, 900, 1024, 1200, 1440, 1920, 2560, 3440];

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

test('project panels pack below shorter neighbors and repack after editing and resizing', async ({ page }, testInfo) => {
  const project = await page.request.post('/api/projects', { data: {
    name: 'Content height project', description: 'A short description.',
    design: '# Reading experience\n\n' + '## Offline reading\n\nPrepare a finite edition for the commute. Articles remain available underground, and annotations stay with the reader.\n\n'.repeat(16),
  } }).then((r) => r.json() as Promise<{ id: number }>);
  const keys: string[] = [];
  for (let i = 0; i < 22; i++) {
    const ticket = await page.request.post('/api/tickets', { data: { project_id: project.id, title: `Prepare and read offline edition ${i + 1}`, status: 'planning' } }).then((r) => r.json() as Promise<{ key: string }>);
    keys.push(ticket.key);
    if (i > 0) await page.request.post(`/api/tickets/${ticket.key}/dependencies`, { data: { blocker: keys[Math.max(0, i - 4)] } });
    if (i >= 8 && i < 16) await page.request.post(`/api/tickets/${ticket.key}/dependencies`, { data: { blocker: keys[i - 7] } });
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/projects/content-height-project-${project.id}`);
  await expect(page.getByTestId('ticket-rows').getByRole('link')).toHaveCount(22);
  const bounds = () => page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>('.gf-tile')];
    return tiles.map((tile) => ({ label: tile.getAttribute('aria-label'), x: tile.offsetLeft, y: tile.offsetTop, height: tile.getBoundingClientRect().height, width: tile.getBoundingClientRect().width }));
  });
  await expect.poll(async () => {
    const tiles = await bounds();
    const about = tiles.find((t) => t.label === 'about')!;
    const design = tiles.find((t) => t.label === 'design')!;
    const history = tiles.find((t) => t.label === 'history')!;
    return about.height < 350 && history.y < design.y + design.height;
  }).toBe(true);
  const tiles = await bounds();
  expect(tiles[0]!.y).toBe(tiles[1]!.y);
  expect(tiles[0]!.x).not.toBe(tiles[1]!.x);
  for (let i = 1; i < tiles.length; i++) expect(tiles[i]!.y).toBeGreaterThanOrEqual(tiles[i - 1]!.y);

  // A tile shortcut still addresses the same DOM tile after packing.
  await page.keyboard.press('ControlOrMeta+4');
  await expect(page.getByRole('region', { name: 'about', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('region', { name: 'about', exact: true }).getByRole('button', { name: 'edit project', exact: true }).click();
  await expect.poll(async () => {
    const current = await bounds();
    const about = current.find((t) => t.label === 'about')!;
    const history = current.find((t) => t.label === 'history')!;
    return history.y >= about.y + about.height + 11;
  }).toBe(true);
  await page.keyboard.press('Escape');

  for (const width of [1024, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => (await bounds()).every((tile) => tile.width <= width - 24)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`project-${width}.png`), fullPage: true });
    const current = await bounds();
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i]!; const b = current[j]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'panels must not overlap').toBe(true);
      }
    }
    if (width === 390) expect(new Set(current.map((tile) => tile.x)).size).toBe(1);
  }
});
