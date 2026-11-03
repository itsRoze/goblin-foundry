import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Named to run after the desktop specs, whose palette rows these tickets would crowd. */

declare global {
  interface Window {
    throwing: boolean;
  }
}

type Ticket = { id: number; key: string; title: string; status: string; description: string };

const VIEW_SENTENCE = 'Couldn’t draw this page; the bar above still works, and a reload tries again.';
const SHELL_SENTENCE = 'Couldn’t draw the app; reload to try again.';

async function create(page: Page, title: string, fields: object = {}) {
  const res = await page.request.post('/api/tickets', { data: { title, description: `${title} words`, status: 'planning', ...fields } });
  return (await res.json()) as Ticket;
}

const read = async (page: Page, ticket: Ticket) => (await (await page.request.get(`/api/tickets/${ticket.key}`)).json()) as Ticket;

/** The schema takes any record as an event's `new`, and `String()` of an object with no callable `toString` throws, so the history tile cannot draw this row. */
const unreadable = (ticket: Ticket) => ({
  id: 1,
  entity_kind: 'ticket',
  entity_id: ticket.id,
  actor: 'human',
  kind: 'transitioned',
  prior: { status: 'backlog' },
  new: { transition: { toString: 1, valueOf: 1 }, status: 'todo' },
  at: '2026-11-02T00:00:00.000Z',
});

async function breakHistory(page: Page, ticket: Ticket, when: () => boolean = () => true) {
  await page.route(`**/api/tickets/${ticket.id}/events`, async (route) => {
    if (when()) await route.fulfill({ json: [unreadable(ticket)] });
    else await route.continue();
  });
}

const expectBroken = (page: Page) => expect(page.getByRole('alert')).toHaveText(VIEW_SENTENCE);
const expectTitle = (page: Page, text: string) => expect(page.getByTestId('page-title')).toContainText(text);

test('a view that throws says so, and the error still reaches the console (GF-102)', async ({ page }) => {
  const broken = await create(page, 'throws in its history');
  await breakHistory(page, broken);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`/tickets/${broken.key}`);

  await expect(page.locator('#root')).toContainText(VIEW_SENTENCE);
  await expect(page.getByRole('navigation', { name: 'workspaces' })).toBeVisible();
  expect(errors.join('\n')).toContain('Cannot convert object to primitive value');
});

test('on reload a record that is still broken says so again, not a blank page (GF-102)', async ({ page }) => {
  const broken = await create(page, 'broken across a reload');
  await breakHistory(page, broken);

  await page.goto(`/tickets/${broken.key}`);
  await expectBroken(page);
  await page.reload();

  await expect(page.locator('#root')).toContainText(VIEW_SENTENCE);
});

test('the bar, the workspace keys and esc all leave a broken view, and coming back says so again (GF-102)', async ({ page }) => {
  const broken = await create(page, 'left by every way out');
  await breakHistory(page, broken);

  await page.goto(`/tickets/${broken.key}`);
  await expectBroken(page);
  await page.getByRole('link', { name: 'settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.goBack();
  await expectBroken(page);
  await page.keyboard.press('3');
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.goBack();
  await expectBroken(page);
  // this view is the first in the session, so `esc` has nowhere further back to go but the board
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the palette opens over a broken view, and the next Ticket is not left blank (GF-102)', async ({ page }) => {
  const broken = await create(page, 'palettegf102 origin');
  const next = await create(page, 'palettegf102 destination');
  await breakHistory(page, broken);

  await page.goto(`/tickets/${broken.key}`);
  await expectBroken(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill(next.title);
  await expect(page.getByRole('option', { name: next.title })).toBeVisible();
  await page.keyboard.press('Enter');

  await expectTitle(page, next.title);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('about-tile')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ControlOrMeta+2');
  await expect(page.getByTestId('design-tile')).toHaveAttribute('aria-current', 'true');
});

test('the page tile takes the tile keys, and `a` acts on no Ticket from a broken view (GF-102)', async ({ page }) => {
  const app = (await (await page.request.post('/api/apps', { data: { name: 'Approve guard app' } })).json()) as { id: number };
  const ticket = await create(page, 'not approved from behind a broken view', { simple: true, app_id: app.id });
  let broken = true;
  await breakHistory(page, ticket, () => broken);

  await page.goto(`/tickets/${ticket.key}`);
  await expectBroken(page);
  await page.keyboard.press('ControlOrMeta+1');
  await expect(page.getByRole('region', { name: 'page' })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('a');
  await expectBroken(page);

  broken = false;
  await page.reload();
  // the history answers after the view's first commit, so the view has offered its Ticket to the keys by now
  await expect(page.getByRole('region', { name: 'history' })).toContainText('created');
  expect((await read(page, ticket)).status).toBe('planning');
  await page.keyboard.press('a');
  await expect.poll(async () => (await read(page, ticket)).status).toBe('ready');
});

test('a link to the address a broken view is on tries again (GF-102)', async ({ page }) => {
  const app = (await (await page.request.post('/api/apps', { data: { name: 'Passing throw app' } })).json()) as { name: string };
  // a throw that passes, which a stored record cannot be: the apps list slugs each name as it draws
  await page.addInitScript(() => {
    const real = String.prototype.normalize;
    window.throwing = true;
    String.prototype.normalize = function (form) {
      if (window.throwing) throw new Error('a passing throw');
      return real.call(this, form);
    };
  });

  await page.goto('/apps');
  await expectBroken(page);
  await page.evaluate(() => {
    window.throwing = false;
  });
  await page.getByRole('link', { name: '3 app' }).click();

  await expect(page.getByRole('main')).toContainText(app.name);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a view that dies in use sends what was typed on its way out (GF-102)', async ({ page }) => {
  const ticket = await create(page, 'dies while being written in');
  let broken = false;
  await breakHistory(page, ticket, () => broken);
  await page.goto(`/tickets/${ticket.key}`);
  await expectTitle(page, ticket.title);
  await expect(page.getByTestId('description')).toContainText(ticket.description);
  // past the query's staleTime, so the refetch below goes out
  await page.waitForTimeout(1_100);

  await page.getByTestId('description').locator('.gf-doc').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' and its last');
  broken = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

  await expectBroken(page);
  await expect.poll(async () => (await read(page, ticket)).description).toBe(`${ticket.title} words and its last`);
});

test('a throw in the shell itself says so too, also on reload (GF-102)', async ({ page }) => {
  // the desk's packing runs in the shell, above the view's boundary
  await page.addInitScript(() => {
    window.ResizeObserver = class {
      constructor() {
        throw new Error('the shell broke');
      }
    } as unknown as typeof ResizeObserver;
  });

  await page.goto('/');
  await expect(page.locator('#root')).toHaveText(SHELL_SENTENCE);
  await page.reload();
  await expect(page.locator('#root')).toHaveText(SHELL_SENTENCE);
});
