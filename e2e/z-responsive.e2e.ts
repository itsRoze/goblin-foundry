import { expect, test } from '@playwright/test';

/**
 * DESIGN.md §5 as an executable check. The desk gains columns past laptop
 * width so that more tiles open rather than the same tiles getting bigger,
 * and the page itself never scrolls sideways — the kanban does that inside
 * its own tile. Prefixed to sort last: it only reads.
 */

/** Laptop is the first grid step; the tiers above it keep a tile from stretching without limit. */
const TIERS: { width: number; columns: number }[] = [
  { width: 375, columns: 1 },
  { width: 900, columns: 1 },
  { width: 1200, columns: 1 },
  { width: 1440, columns: 2 },
  { width: 1920, columns: 3 },
  { width: 2560, columns: 4 },
];

const layout = () => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  columns: getComputedStyle(document.querySelector('.gf-desk')!).gridTemplateColumns.split(' ').length,
});

test('the desk gains columns with width, and no page ever scrolls sideways', async ({ page }) => {
  for (const { width, columns } of TIERS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/apps', '/projects']) {
      await page.goto(path);
      await page.waitForSelector('.gf-desk .gf-tile');
      expect(await page.evaluate(layout), `${path} at ${width}px`).toEqual({ overflow: 0, columns });
    }
  }
});

test('the kanban scrolls inside its tile rather than the page, and the bar sheds words before it overflows', async ({ page }) => {
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
  // the ways out of the board are never among the words dropped
  await expect(page.getByRole('link', { name: 'trash' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'settings' })).toBeVisible();
});
