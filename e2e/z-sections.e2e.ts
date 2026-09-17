import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 11's exit criterion, the stacked half: a phone-width board is sections
 * down the page, each folded or open on its own and remembered on this device;
 * a card's `⋯` moves it through the same table the keys and the drag read; and
 * a move into a folded section says where the card went without going there.
 * Named to sort late — one worker shares one database, and the earlier specs
 * address the tickets they made by key.
 */

const PHONE = { width: 390, height: 800 };

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });
const section = (page: Page, status: string) => page.getByTestId(`section-${status}`);
const head = (page: Page, status: string) => page.getByTestId(`section-head-${status}`);
const count = (page: Page, status: string) => head(page, status).locator('b');

/** A ticket straight from the API, so the board under test is the one thing the test is about. */
async function seed(page: Page, title: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await page.request.post('/api/tickets', { data: { title, ...body } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { key: string }).key;
}

/** The last move the board reported, wherever on the board it landed. */
const notice = (page: Page) => page.locator('[data-testid^="notice-"]');

test('a clean device opens the working statuses and folds the rest, headings and counts on show', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await seed(page, 'Folded in backlog');
  await page.goto('/');
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'vertical');

  for (const status of ['planning', 'ready', 'building', 'review']) await expect(head(page, status)).toHaveAttribute('aria-expanded', 'true');
  for (const status of ['backlog', 'todo', 'done']) await expect(head(page, status)).toHaveAttribute('aria-expanded', 'false');
  // cancelled is off the board until the Filter names it, as ever
  await expect(section(page, 'cancelled')).toHaveCount(0);

  // a folded section still says what it holds; its cards are simply not drawn
  await expect(head(page, 'backlog')).toBeVisible();
  expect(Number(await count(page, 'backlog').textContent())).toBeGreaterThanOrEqual(1);
  await expect(card(page, 'Folded in backlog')).toHaveCount(0);
  // the tile's own count is the Filter's, not the open sections'
  const shown = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="section-head-"] b')].reduce((n, b) => n + Number(b.textContent), 0));
  await expect(page.getByTestId('board-tile').locator('.gf-tile-sub')).toHaveText(String(shown));
});

test('expansion is this device\'s memory: it survives a reload, a revisit, a filter, a resize and a poll, and never touches the address', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await seed(page, 'Remembered open');
  await page.goto('/?q=Remembered');
  await expect(card(page, 'Remembered open')).toHaveCount(0);

  await head(page, 'backlog').click();
  await expect(head(page, 'backlog')).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page, 'Remembered open')).toBeVisible();
  await expect(page).toHaveURL(/\/\?q=Remembered$/);
  await head(page, 'ready').click();
  await expect(head(page, 'ready')).toHaveAttribute('aria-expanded', 'false');

  // a reload, and coming back from elsewhere
  await page.reload();
  await expect(head(page, 'backlog')).toHaveAttribute('aria-expanded', 'true');
  await expect(head(page, 'ready')).toHaveAttribute('aria-expanded', 'false');
  await page.goto('/settings');
  await page.goto('/');
  await expect(head(page, 'backlog')).toHaveAttribute('aria-expanded', 'true');

  // a filter changes what is on the board, not how it is folded
  await page.getByTestId('chip-status').click();
  await page.getByTestId('check-cancelled').click();
  await expect(section(page, 'cancelled')).toBeVisible();
  await expect(head(page, 'cancelled')).toHaveAttribute('aria-expanded', 'false');
  await expect(head(page, 'backlog')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');

  // a background write lands without rearranging the page
  await seed(page, 'Arrived while watching');
  await expect(card(page, 'Arrived while watching')).toBeVisible({ timeout: 10_000 });
  await expect(head(page, 'backlog')).toHaveAttribute('aria-expanded', 'true');
  await expect(head(page, 'ready')).toHaveAttribute('aria-expanded', 'false');

  // the kanban and back: the choices are still there
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'horizontal');
  await page.setViewportSize(PHONE);
  await expect(head(page, 'backlog')).toHaveAttribute('aria-expanded', 'true');
  await expect(head(page, 'ready')).toHaveAttribute('aria-expanded', 'false');
  // and put back, so the next test meets a clean device
  await head(page, 'ready').click();
});

test('the card menu moves its own card and leaves the Cursor where it was', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const pointed = await seed(page, 'Menu pair: pointed at', { status: 'planning' });
  const moved = await seed(page, 'Menu pair: moved', { status: 'planning' });
  await page.goto('/?q=Menu%20pair');
  await expect(card(page, 'Menu pair: moved')).toBeVisible();

  await page.keyboard.press('j');
  await expect(page.getByTestId(`card-${pointed}`)).toHaveClass(/is-cursor/);

  // the menu is quiet, and it targets the card it hangs off
  await page.getByTestId(`menu-${moved}`).click();
  const menu = page.getByTestId(`card-menu-${moved}`);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toHaveText(/approve/);
  await page.getByTestId(`menu-${moved}-approve`).click();

  // no app and no design: the guard refuses, in words, under the card it was about
  await expect(page.getByTestId('refusal-planning')).toContainText('approve needs');
  await expect(page.getByTestId(`card-${moved}`)).toBeVisible();
  await expect(page.getByTestId(`card-${pointed}`)).toHaveClass(/is-cursor/);

  // a move that is allowed goes through, and the Cursor still has not moved
  await page.getByTestId(`menu-${moved}`).click();
  await page.getByTestId(`menu-${moved}-pick`).click();
  await expect(section(page, 'todo').locator(`[data-testid="card-${moved}"]`)).toHaveCount(0); // todo is folded
  await expect(count(page, 'todo')).toHaveText('1');
  await expect(page.getByTestId(`card-${pointed}`)).toHaveClass(/is-cursor/);
});

test('a move into a folded section keeps the page where it was, updates the count, and show is what reveals it', async ({ page }) => {
  // a short window and a page of cards below the one that moves, so there is somewhere to stand
  // part-way down that the page could still hold after the card has gone
  await page.setViewportSize({ width: 390, height: 480 });
  const key = await seed(page, 'Off to todo', { status: 'planning' });
  for (const n of [1, 2, 3, 4, 5, 6]) await seed(page, `Off to todo, filler ${n}`, { status: 'planning' });
  await page.goto('/?q=Off%20to%20todo');
  await expect(page.getByTestId(`card-${key}`)).toBeVisible();
  await expect(head(page, 'todo')).toHaveAttribute('aria-expanded', 'false');
  await expect(count(page, 'todo')).toHaveText('0');

  // stand somewhere down the page and act from there
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.getByTestId(`menu-${key}`).click();
  await expect(page.getByTestId(`card-menu-${key}`)).toBeVisible();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await page.getByTestId(`menu-${key}-pick`).click();

  // the destination stays folded, its count moves, and the sentence is said where the card was
  await expect(count(page, 'todo')).toHaveText('1');
  await expect(head(page, 'todo')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId(`card-${key}`)).toHaveCount(0);
  await expect(page.getByTestId('notice-planning')).toContainText(`${key} moved to todo`);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  // show, on request: the section opens, the card is on screen and the Cursor is on it
  await page.getByTestId('notice-show').click();
  await expect(head(page, 'todo')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`card-${key}`)).toBeInViewport();
  await expect(page.getByTestId(`card-${key}`)).toHaveClass(/is-cursor/);
  await expect(notice(page)).toHaveCount(0);
  // and that is remembered as an opening would be
  await page.reload();
  await expect(head(page, 'todo')).toHaveAttribute('aria-expanded', 'true');
  await head(page, 'todo').click();
});

test('a move to a status the filter leaves off says so, and open is the honest way to it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const key = await seed(page, 'Leaves the board', { status: 'planning' });
  await page.goto('/?status=planning,ready&q=Leaves');
  await expect(card(page, 'Leaves the board')).toBeVisible();

  await page.getByTestId(`menu-${key}`).click();
  await page.getByTestId(`menu-${key}-shelve`).click();
  await expect(card(page, 'Leaves the board')).toHaveCount(0);
  await expect(page.getByTestId('notice-planning')).toContainText(`${key} moved to backlog, which this filter leaves off`);
  // the Filter is not touched to show it
  await expect(page).toHaveURL(/status=planning,ready/);
  await expect(section(page, 'backlog')).toHaveCount(0);

  await page.getByTestId('notice-show').click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${key}$`));
  await expect(page.getByTestId('state-tile')).toContainText('backlog');
});

test('the blocked start asks first from the menu too, and the question does not fold away', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const app = await page.request.post('/api/apps', { data: { name: 'Sections' } }).then((r) => r.json() as Promise<{ id: number }>);
  const blocker = await seed(page, 'Still in the way');
  const blocked = await seed(page, 'Waits on the menu', { status: 'ready', app_id: app.id, simple: true });
  await page.request.post(`/api/tickets/${blocked}/dependencies`, { data: { blocker } });
  await page.goto('/?q=Waits%20on%20the%20menu');
  await expect(card(page, 'Waits on the menu')).toHaveClass(/is-blocked/);

  await page.getByTestId(`menu-${blocked}`).click();
  await page.getByTestId(`menu-${blocked}-start`).click();
  await expect(page.getByTestId('confirm-ready')).toContainText('still blocks this');
  await expect(page.getByTestId('confirm-ready')).toBeInViewport();

  // folding the section it is in keeps the question on screen, under the heading
  await head(page, 'ready').click();
  await expect(card(page, 'Waits on the menu')).toHaveCount(0);
  await expect(page.getByTestId('confirm-ready')).toBeVisible();
  await page.getByTestId('confirm-ready-yes').click();
  await expect(count(page, 'building')).toHaveText('1');
  await expect(page.getByTestId('notice-ready')).toHaveCount(0); // building is open by default, so nothing to say
  await head(page, 'ready').click();
});

test('the keyboard still walks the stacked board, one column of what is open, and a folded card takes the cursor with it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const app = await page.request.post('/api/apps', { data: { name: 'Walked' } }).then((r) => r.json() as Promise<{ id: number }>);
  const first = await seed(page, 'First down the page', { status: 'planning' });
  const second = await seed(page, 'Second down the page', { status: 'ready', app_id: app.id, simple: true });
  await page.goto('/?q=down%20the%20page');
  await expect(card(page, 'Second down the page')).toBeVisible();

  // `j` runs from one section into the next: the stacked board is one column
  await page.keyboard.press('j');
  await expect(page.getByTestId(`card-${first}`)).toHaveClass(/is-cursor/);
  await page.keyboard.press('j');
  await expect(page.getByTestId(`card-${second}`)).toHaveClass(/is-cursor/);
  await page.keyboard.press('k');
  await expect(page.getByTestId(`card-${first}`)).toHaveClass(/is-cursor/);

  // folding the section under the Cursor lets it go — `a s d` must not fire on a card nobody can see
  await head(page, 'planning').click();
  await expect(page.locator('.is-cursor')).toHaveCount(0);
  await page.keyboard.press('a');
  await expect(page.locator('[data-testid^="refusal-"]')).toHaveCount(0);
  await page.keyboard.press('j');
  await expect(page.getByTestId(`card-${second}`)).toHaveClass(/is-cursor/);
  await head(page, 'planning').click();
});

test('the keys belong to the menu while it is open: ⏎ runs the row and does not open the card under the Cursor', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const key = await seed(page, 'Menu by keys', { status: 'planning' });
  await page.goto('/?q=Menu%20by%20keys');
  await expect(card(page, 'Menu by keys')).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByTestId(`card-${key}`)).toHaveClass(/is-cursor/);

  // the first row takes the focus; `↓` walks to `pick`; `⏎` runs it and nothing else
  await page.getByTestId(`menu-${key}`).click();
  await expect(page.getByTestId(`menu-${key}-approve`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId(`menu-${key}-pick`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/\?q=Menu%20by%20keys$/);
  await expect(count(page, 'todo')).toHaveText('1');
  await expect(page.getByTestId(`card-menu-${key}`)).toHaveCount(0);
});
