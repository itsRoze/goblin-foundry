import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * GF-9. Focus follows `mousedown`, so a header that lays itself out again on
 * focus moves the button out from under a press in progress and the browser
 * fires no click (docs/LESSONS.md, 2026-08-30).
 */

const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;

type Rect = [tag: string, text: string, left: number, top: number, width: number, height: number];

/** Every tile header control's box, keyed by the tile's label; relative to its header, since `⌘n` scrolls. */
const headerBoxes = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, Rect[]> = {};
    for (const tile of document.querySelectorAll<HTMLElement>('.gf-tile')) {
      const head = tile.querySelector('.gf-tile-head')!.getBoundingClientRect();
      const label = tile.getAttribute('aria-label') ?? '?';
      out[label] = [...tile.querySelectorAll<HTMLElement>('.gf-tile-keys > :not(.gf-tile-move)')].map((el) => {
        const r = el.getBoundingClientRect();
        return [el.tagName, el.textContent ?? '', Math.round(r.left - head.left), Math.round(r.top - head.top), Math.round(r.width), Math.round(r.height)];
      });
    }
    return out;
  });

/** Each test seeds its own rows: a failed test restarts the worker, and module state goes with it. */
async function seed(page: Page) {
  const app = await post<{ id: number }>(page, '/api/apps', { name: 'Rimward' });
  const project = await post<{ id: number }>(page, '/api/projects', { name: 'Rimward project', app_id: app.id });
  const ticket = await post<{ key: string }>(page, '/api/tickets', { title: 'Rimward ticket', status: 'planning', project_id: project.id });
  return { appPath: `/apps/rimward-${app.id}`, projectPath: `/projects/rimward-project-${project.id}`, ticketPath: `/tickets/${ticket.key}` };
}

test('the first click on an unfocused tile header control works', async ({ page }) => {
  const { appPath } = await seed(page);
  await page.goto(appPath);
  await page.getByTestId('about-tile').locator('.gf-tile-head > span').first().click();
  await expect(page.getByTestId('about-tile')).toHaveClass(/is-focus/);
  await expect(page.getByTestId('projects-tile')).not.toHaveClass(/is-focus/);
  // the hint goes with the focus, but its seat stays
  await expect(page.getByTestId('about-tile').locator('.gf-tile-move')).toHaveCount(0);
  await expect(page.getByTestId('projects-tile').locator('.gf-tile-move')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+1');
  await expect(page.getByTestId('projects-tile').locator('.gf-tile-move')).toBeVisible();
  await page.getByTestId('about-tile').locator('.gf-tile-head > span').first().click();

  // a real press and release: Playwright's click moves the mouse, so a button that shifts between down and up is missed
  await page.getByRole('button', { name: 'new project' }).click();
  await expect(page.getByTestId('new-project-form')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-project-form')).toHaveCount(0);

  await page.getByTestId('about-tile').locator('.gf-tile-head > span').first().click();
  await expect(page.getByTestId('tickets-tile')).not.toHaveClass(/is-focus/);
  await page.getByTestId('tickets-tile').getByRole('button', { name: /new/ }).click();
  await expect(page.getByTestId('tickets-tile').getByLabel('ticket title')).toBeVisible();
});

test('a tile header lays out the same whichever tile has the focus', async ({ page }) => {
  const { appPath, projectPath, ticketPath } = await seed(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // not the board: one tile, so its focus has nowhere to move
    for (const route of [appPath, projectPath, ticketPath]) {
      await page.goto(route);
      await page.waitForSelector('.gf-desk .gf-tile');
      const count = await page.locator('.gf-desk .gf-tile').count();
      const baseline = await headerBoxes(page);
      for (let n = 2; n <= count; n++) {
        await page.keyboard.press(`ControlOrMeta+${n}`);
        await expect(page.locator('.gf-desk .gf-tile').nth(n - 1)).toHaveClass(/is-focus/);
        expect(await headerBoxes(page), `${route} at ${width}px with tile ${n} focused`).toEqual(baseline);
      }
    }
  }
});

/**
 * GF-42. The board header's Cursor hints (`x select`, `a approve`, `s status`,
 * `d deps`) came and went with the Cursor and the Selection, so at 390px the
 * strip grew a line and every card moved 25px under the finger, and `s status`
 * and `d deps` were offered with no Cursor for them to act on.
 */

const CURSOR_HINTS = ['x select', 's status', 'd deps', 'a approve'];
const hint = (page: Page, text: string) => page.getByTestId('board-tile').locator('.gf-tile-keys .gf-hint', { hasText: text });

/** The header's height, every hint's box relative to the header (seated or not), and where the first card starts. */
const boardLayout = (page: Page) =>
  page.evaluate(() => {
    const head = document.querySelector<HTMLElement>('[data-testid="board-tile"] .gf-tile-head')!;
    const h = head.getBoundingClientRect();
    const card = document.querySelector<HTMLElement>('[data-testid^="card-"]')!.getBoundingClientRect();
    const hints = [...head.querySelectorAll<HTMLElement>('.gf-tile-keys > *')].map((el) => {
      const r = el.getBoundingClientRect();
      return [el.textContent ?? '', Math.round(r.left - h.left), Math.round(r.top - h.top), Math.round(r.width), Math.round(r.height)];
    });
    return { head: Math.round(h.height), cardTop: Math.round(card.top + window.scrollY), hints };
  });

/** A `planning` card (it has the `approve` arrow) and a `building` one, on a board narrowed to the pair: `j` must find no third card, whatever earlier runs left. */
async function seedBoard(page: Page) {
  const app = await post<{ id: number }>(page, '/api/apps', { name: 'Headrow' });
  const q = `Headrow${app.id.toString(36)}x`;
  const one = await post<{ key: string }>(page, '/api/tickets', { title: `${q} one`, app_id: app.id, simple: true, status: 'planning' });
  await post(page, '/api/tickets', { title: `${q} two`, app_id: app.id, simple: true, status: 'building' });
  await page.goto(`/?q=${q}`);
  await expect(page.locator('[data-testid^="card-"]').first()).toBeVisible();
  return one.key;
}

test('the board header offers the Cursor’s keys only while there is a Cursor for them to act on', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBoard(page);
  for (const text of CURSOR_HINTS) await expect(hint(page, text)).toBeHidden();
  // `⇧↓` plants a Cursor when there is none, so it is always offered
  await expect(hint(page, '⇧↓ range')).toBeVisible();
  // not for a screen reader, and not for Tab: from `v view` the next stop is `⌘A select all`
  await expect(page.getByRole('button', { name: 'd deps' })).toHaveCount(0);
  await page.getByTestId('hint-view').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('hint-select-all')).toBeFocused();
  // the empty seats come after the last hint on show, so there is no hole between two hints
  const strip = await page.getByTestId('board-tile').locator('.gf-tile-keys > *').evaluateAll((els) => els.map((el) => ({ text: el.textContent, off: el.classList.contains('is-off'), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
  expect(strip.filter((el) => !el.off).map((el) => el.text)).toEqual(['jk⏎', 'c new', 'f find', 'v view', '⌘A select all', '⇧↓ range']);
  const lastShown = strip.filter((el) => !el.off).at(-1)!;
  for (const seat of strip.filter((el) => el.off)) expect(seat.left, seat.text ?? '').toBeGreaterThanOrEqual(lastShown.right);

  await page.keyboard.press('j');
  await expect(page.locator('.gf-card.is-cursor')).toContainText(' one');
  for (const text of CURSOR_HINTS) await expect(hint(page, text)).toBeVisible();
  // `building` has no `approve` arrow
  await page.keyboard.press('l');
  await expect(page.locator('.gf-card.is-cursor')).toContainText(' two');
  await expect(hint(page, 'a approve')).toBeHidden();
  await expect(hint(page, 's status')).toBeVisible();
  // with a Selection the verbs are the selection bar's; the Cursor still selects
  await page.keyboard.press('x');
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await expect(hint(page, 'x select')).toBeVisible();
  await expect(hint(page, 's status')).toBeHidden();
  await expect(hint(page, 'd deps')).toBeHidden();
});

test('the board header lays out the same with and without a Cursor or a Selection, so the first card never moves', async ({ browser, baseURL }) => {
  for (const width of [390, 768, 1280, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, baseURL });
    const page = await ctx.newPage();
    const key = await seedBoard(page);
    const baseline = await boardLayout(page);
    await page.keyboard.press('j');
    await expect(page.locator('.gf-card.is-cursor')).toContainText(' one');
    expect(await boardLayout(page), `${width}px with the Cursor on a card with approve`).toEqual(baseline);
    await page.keyboard.press(width < 768 ? 'j' : 'l');
    await expect(page.locator('.gf-card.is-cursor')).toContainText(' two');
    expect(await boardLayout(page), `${width}px with the Cursor on a card without approve`).toEqual(baseline);
    await page.keyboard.press('x');
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    expect(await boardLayout(page), `${width}px with a Selection`).toEqual(baseline);
    await page.reload();
    await page.getByTestId(`select-${key}`).check();
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    expect(await boardLayout(page), `${width}px ticked`).toEqual(baseline);
    // the comparison counted the seats, not just the hints on show
    expect(baseline.hints.map(([text]) => text)).toContain('x select');
    await ctx.close();
  }
});

test('on a coarse pointer the Cursor’s hints and their seats take no room', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 900 }, baseURL });
  const page = await ctx.newPage();
  const key = await seedBoard(page);
  const noRoom = await page.getByTestId('board-tile').locator('.gf-tile-keys > *').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width === 0).map((el) => el.textContent));
  expect(noRoom).toEqual(['jk⏎', '⇧↓ range', ...CURSOR_HINTS]);
  const before = await boardLayout(page);
  await page.getByTestId(`select-${key}`).tap();
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  expect(await boardLayout(page)).toEqual(before);
  // a hardware keyboard can plant a Cursor on a coarse pointer; the hints stay folded with their seats, so the strip holds its line
  await page.reload();
  await expect(page.locator('[data-testid^="card-"]').first()).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.locator('.gf-card.is-cursor')).toContainText(' one');
  expect(await boardLayout(page), 'with a planted Cursor').toEqual(before);
  await page.keyboard.press('x');
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  expect(await boardLayout(page), 'with a planted Cursor and a Selection').toEqual(before);
  await ctx.close();
});
