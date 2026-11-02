import { expect, test } from '@playwright/test';
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
