import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 10's exit criterion: the tracker driven by the keyboard alone. Named
 * to sort late — one worker shares one database, and the earlier specs address
 * the tickets they made by key.
 *
 * Every cursor test narrows the board with `?q=` first. The Cursor's first
 * press lands on the first card of the first non-empty column, and by now that
 * is somebody else's ticket; filtering to one card is what makes "`j` puts the
 * cursor on it" a statement about the cursor rather than about the fixture.
 */

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });
const board = (page: Page, q: string) => page.goto(`/?q=${encodeURIComponent(q)}`);

/** A ticket from the board's create row, with everything the approve guard wants already on it. */
async function create(page: Page, title: string, { app, status, simple }: { app?: string; status?: string; simple?: boolean } = {}) {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  const row = page.getByTestId('board-create');
  await row.getByLabel('ticket title').fill(title);
  if (app) await row.getByLabel('app').selectOption({ label: app });
  if (status) await row.getByLabel('status').selectOption(status);
  if (simple) await row.getByRole('checkbox').check();
  await row.getByLabel('ticket title').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('board')).toContainText(title);
}

/** The key the API gave it, read off the card the board drew. */
async function keyOf(page: Page, title: string): Promise<string> {
  const id = await card(page, title).getAttribute('data-testid');
  return id!.replace('card-', '');
}

test('an app to hang the keyboard tickets on', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  await page.getByTestId('new-app-form').getByLabel('name').fill('Keyboard');
  await page.getByTestId('new-app-form').getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('page-title')).toHaveText('Keyboard');
});

test('c makes a ticket, j points at it, ⏎ opens it, and esc comes back to where the cursor was', async ({ page }) => {
  await create(page, 'Cursor rides the board');
  await board(page, 'Cursor rides');
  const only = card(page, 'Cursor rides the board');
  await expect(only).toBeVisible();

  // the focused tile offers the moves; the board is the only tile on its desk, so it carries no number
  await expect(page.getByTestId('board-tile')).toContainText('j');
  await expect(page.getByTestId('board-tile')).not.toContainText('⌘');

  await page.keyboard.press('j');
  await expect(only).toHaveClass(/is-cursor/);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await expect(page.getByTestId('page-title')).toContainText('Cursor rides the board');

  // `esc` with nothing open walks back, and the board still knows which card you were on
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(card(page, 'Cursor rides the board')).toHaveClass(/is-cursor/);

  // and `esc` on the board lets it go
  await page.keyboard.press('Escape');
  await expect(card(page, 'Cursor rides the board')).not.toHaveClass(/is-cursor/);
});

test('⌘K finds a ticket by its key and opens it', async ({ page }) => {
  await create(page, 'Found by key alone');
  const key = await keyOf(page, 'Found by key alone');

  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill(key);
  // the exact key is the first row, so `⏎` takes it — but wait for it to be there (LESSONS 2026-09-03)
  await expect(page.getByTestId(`run-ticket-${key}`)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tickets/${key}$`));
  await expect(page.getByTestId('page-title')).toContainText('Found by key alone');
});

test('s on the board runs the same approve the state tile does, and lands the card in ready', async ({ page }) => {
  await create(page, 'Approved by key', { app: 'Keyboard', status: 'todo', simple: true });
  await board(page, 'Approved by key');
  await expect(card(page, 'Approved by key')).toBeVisible();

  await page.keyboard.press('j');
  await expect(card(page, 'Approved by key')).toHaveClass(/is-cursor/);
  await page.keyboard.press('s');
  // the panel covers the card it is about, so its group label names the ticket
  await expect(page.getByTestId('palette')).toContainText(await keyOf(page, 'Approved by key'));
  await page.getByTestId('palette').getByLabel('command palette').fill('approve');
  await expect(page.getByTestId('run-move-approve')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('col-ready')).toContainText('Approved by key');
  await expect(page.getByTestId('palette')).toHaveCount(0);
});

test('a on a ticket with no approve arrow refuses locally, under the column the cursor is in', async ({ page }) => {
  await create(page, 'No arrow from backlog');
  await board(page, 'No arrow from backlog');
  await expect(card(page, 'No arrow from backlog')).toBeVisible();

  // the cursor has to be on screen before the key that acts on it (LESSONS 2026-09-03)
  await page.keyboard.press('j');
  await expect(card(page, 'No arrow from backlog')).toHaveClass(/is-cursor/);
  await page.keyboard.press('a');
  await expect(page.getByTestId('refusal-backlog')).toHaveText('a ticket in backlog does not go to ready');
  await expect(page.getByTestId('col-backlog')).toContainText('No arrow from backlog');
});

test('d goes where the button is and presses it: the blocked-by picker is open on arrival', async ({ page }) => {
  await board(page, 'Cursor rides');
  await expect(card(page, 'Cursor rides the board')).toBeVisible();
  await page.keyboard.press('j');
  await expect(card(page, 'Cursor rides the board')).toHaveClass(/is-cursor/);
  await page.keyboard.press('d');

  await expect(page.getByTestId('dependencies-tile')).toBeVisible();
  await expect(page.getByTestId('picker-depends_on')).toBeVisible();
  await expect(page.getByTestId('dependencies-tile')).toHaveClass(/is-focus/);

  // `esc` closes the topmost open thing before it walks back — including from outside the picker's own input
  const url = page.url();
  await page.getByTestId('state-tile').getByText('status').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
  await expect(page).toHaveURL(url);
});

test('⌘2 moves the focus to the design tile, and e lands the caret in it', async ({ page }) => {
  await board(page, 'Cursor rides');
  await card(page, 'Cursor rides the board').click();
  await expect(page.getByTestId('design-tile')).toBeVisible();
  // the about tile is tile 1 and has the focus until something says otherwise
  await expect(page.getByTestId('about-tile')).toHaveClass(/is-focus/);

  // a Ticket view has five tiles, so every header names its own number
  await expect(page.getByTestId('design-tile')).toContainText('⌘2');
  await page.keyboard.press('ControlOrMeta+2');
  await expect(page.getByTestId('design-tile')).toHaveClass(/is-focus/);
  await expect(page.getByTestId('about-tile')).not.toHaveClass(/is-focus/);

  await page.keyboard.press('e');
  await expect(page.getByTestId('design-tile').locator('.gf-doc')).toBeFocused();
});

test('the palette creates by name and goes by name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();

  // `new ticket` is the `c` form in the scope on screen — the board's create row
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill('new ticket');
  await expect(page.getByTestId('run-create-ticket')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('board-create')).toBeVisible();
  await page.getByTestId('board-create').getByLabel('ticket title').press('Escape');

  // an empty query shows every group, not just the longest one (issue 10 close-out)
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toContainText('go to');
  await expect(page.getByTestId('palette')).toContainText('create');
  await page.getByTestId('palette').getByLabel('command palette').press('Escape');

  // `go to` reaches a page the bar has no room for as easily as one it does
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill('settings');
  await expect(page.getByTestId('run-go-settings')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ticket-prefix')).toHaveText('GF');
});

test('rows are a cursor too: j and ⏎ open a ticket from an App view', async ({ page }) => {
  await page.goto('/apps');
  await expect(page.getByTestId('apps-tile')).toBeVisible();
  await page.getByRole('link', { name: 'Keyboard' }).click();
  await expect(page.getByTestId('ticket-rows')).toBeVisible();

  // the tickets tile is the second on an App view, and `j` moves inside whichever tile has the focus
  await page.keyboard.press('ControlOrMeta+2');
  await expect(page.getByTestId('tickets-tile')).toHaveClass(/is-focus/);
  await page.keyboard.press('j');
  await expect(page.getByTestId('ticket-rows').locator('.is-cursor')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await expect(page.getByTestId('page-title')).toContainText('Approved by key');
});
