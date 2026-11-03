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
  // (`⌘A all` is a hint of its own; the number would be `⌘1`)
  await expect(page.getByTestId('board-tile')).not.toContainText('⌘1');

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

  // a Ticket view has six tiles, so every header names its own number
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

test('⏎ answers to the focused link or button until the Cursor moves (GF-39)', async ({ page }) => {
  await create(page, 'Entroute one');
  await create(page, 'Entroute two');
  await board(page, 'Entroute');
  const one = card(page, 'Entroute one');
  const two = card(page, 'Entroute two');
  await expect(two).toBeVisible();

  await page.keyboard.press('j');
  await expect(one).toHaveClass(/is-cursor/);

  await two.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toContainText('Entroute two');
  await page.keyboard.press('Escape');
  await expect(one).toHaveClass(/is-cursor/);

  await one.focus();
  await page.keyboard.press('j');
  await expect(two).toHaveClass(/is-cursor/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toContainText('Entroute two');
  await page.keyboard.press('Escape');
  await expect(two).toHaveClass(/is-cursor/);

  const oneKey = await keyOf(page, 'Entroute one');
  await page.getByTestId(`menu-${oneKey}`).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`card-menu-${oneKey}`)).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
});

test('⇧↓ is a Cursor move too, so it takes ⏎ back from the focused card (GF-39)', async ({ page }) => {
  await create(page, 'Rangeroute one');
  await create(page, 'Rangeroute two');
  await board(page, 'Rangeroute');
  const one = card(page, 'Rangeroute one');
  const two = card(page, 'Rangeroute two');
  await expect(two).toBeVisible();

  await page.keyboard.press('j');
  await expect(one).toHaveClass(/is-cursor/);
  await one.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(two).toHaveClass(/is-cursor/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toContainText('Rangeroute two');
});

test('a Cursor key that moves nothing leaves ⏎ with the focused control (GF-39)', async ({ page }) => {
  await create(page, 'Nowherego');
  await board(page, 'Nowherego');
  const only = card(page, 'Nowherego');
  await expect(only).toBeVisible();
  await page.keyboard.press('j');
  await expect(only).toHaveClass(/is-cursor/);

  const key = await keyOf(page, 'Nowherego');
  await page.getByTestId(`menu-${key}`).focus();
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`card-menu-${key}`)).toBeVisible();
});

test('a new page lets go of the link that led there, so ⏎ means the Cursor again (GF-39)', async ({ page }) => {
  await create(page, 'Shellroute card');
  await board(page, 'Shellroute');
  const only = card(page, 'Shellroute card');
  await expect(only).toBeVisible();
  await page.keyboard.press('j');
  await expect(only).toHaveClass(/is-cursor/);

  await page.getByRole('link', { name: 'settings' }).click();
  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(only).toHaveClass(/is-cursor/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toContainText('Shellroute card');
});

async function seed(page: Page, title: string): Promise<string> {
  const response = await page.request.post('/api/tickets', { data: { title } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { key: string }).key;
}

test('a menu at the foot of a column or on a short screen keeps every row on screen and reachable by key, and it follows a scroll until its card leaves (GF-78)', async ({ page }) => {
  for (const n of ['one', 'two', 'three', 'four']) await seed(page, `Footmenu ${n}`);
  await board(page, 'Footmenu');
  const last = page.getByTestId('col-backlog').locator('.gf-card').last();
  await expect(last).toBeVisible();
  const key = (await last.getAttribute('data-key'))!;

  await page.getByTestId(`menu-${key}`).click();
  await expect(page.getByTestId(`menu-${key}-pick`)).toBeFocused();
  await expect(page.getByTestId(`menu-${key}-trash`)).toBeInViewport();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId(`menu-${key}-trash`)).toBeFocused();
  await expect(page.getByTestId(`menu-${key}-trash`)).toBeInViewport();

  await page.keyboard.press('Tab');
  await expect(page.getByTestId(`card-menu-${key}`)).toHaveCount(0);
  await page.getByTestId(`menu-${key}`).click();
  await expect(page.getByTestId(`menu-${key}-pick`)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`card-menu-${key}`)).toHaveCount(0);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId(`menu-${key}`).click();
  await expect(page.getByTestId(`menu-${key}-pick`)).toBeFocused();
  const rows = await page.getByTestId(`card-menu-${key}`).getByRole('menuitem').count();
  expect(rows).toBe(6);
  for (let i = 1; i <= rows; i++) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`card-menu-${key}`).getByRole('menuitem').nth(i % rows)).toBeFocused();
    await expect(page.getByTestId(`card-menu-${key}`).getByRole('menuitem').nth(i % rows)).toBeInViewport();
  }

  const edge = async () => {
    const menu = await page.getByTestId(`card-menu-${key}`).boundingBox();
    const dots = await page.getByTestId(`menu-${key}`).boundingBox();
    return Math.round(menu!.x + menu!.width - (dots!.x + dots!.width));
  };
  await expect.poll(edge).toBe(0);
  await page.getByTestId('board').evaluate((el) => el.scrollBy(40, 0));
  await expect(page.getByTestId(`menu-${key}-pick`)).toBeFocused();
  await expect.poll(edge).toBe(0);
  await page.getByTestId('board').evaluate((el) => el.scrollBy(600, 0));
  await expect(page.getByTestId(`card-menu-${key}`)).toHaveCount(0);
});

test('holding ⏎ on a focused ⋯ opens the menu and runs nothing (GF-82)', async ({ page }) => {
  const key = await seed(page, 'Heldenter');
  await board(page, 'Heldenter');
  const only = card(page, 'Heldenter');
  await expect(only).toHaveAttribute('data-status', 'backlog');

  await page.getByTestId(`menu-${key}`).focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId(`menu-${key}-pick`)).toBeFocused();
  await expect(page.getByTestId(`card-menu-${key}`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`card-menu-${key}`)).toHaveCount(0);
  await expect(only).toHaveAttribute('data-status', 'backlog');
});

test('a focused filter popover keeps the board keys, and a held ⏎ on its chip toggles nothing (GF-92)', async ({ page }) => {
  const key = await seed(page, 'Behindpop');
  await board(page, 'Behindpop');
  const only = card(page, 'Behindpop');
  await expect(only).toBeVisible();
  const pop = page.getByTestId('pop-status');

  await page.getByTestId('chip-status').click();
  await expect(pop).toBeVisible();
  await expect(page.getByRole('group', { name: 'filter by status' })).toBeFocused();
  await page.keyboard.press('j');
  await expect(only).not.toHaveClass(/is-cursor/);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(only).not.toHaveClass(/is-cursor/);

  await page.keyboard.press('j');
  await expect(only).toHaveClass(/is-cursor/);
  await page.getByTestId('chip-label').click();
  await expect(page.getByTestId('pop-label')).toBeVisible();
  await expect(page.getByRole('group', { name: 'filter by label' })).toBeFocused();
  await page.keyboard.press('x');
  await page.keyboard.press('k');
  await expect(page.getByTestId(`select-${key}`)).not.toBeChecked();
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pop-label')).toHaveCount(0);
  await expect(only).toHaveClass(/is-cursor/);

  await page.getByTestId('chip-status').click();
  await expect(pop).toBeVisible();
  await page.keyboard.press('s');
  await page.keyboard.press('v');
  await page.keyboard.press('c');
  await page.keyboard.press('f');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('view-menu')).toHaveCount(0);
  await expect(page.getByTestId('board-create')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'filter by status' })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  // the palette handed the focus back; the popover is still the topmost open thing, so `esc` closes it (GF-98, GF-103)
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);

  await page.getByTestId('chip-status').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(pop).toBeVisible();
  await expect(page.getByTestId('check-backlog')).toBeChecked();
  await expect(page.getByTestId('chip-status')).toHaveText('status');
});

test('esc closes a filter popover that lost the focus and hands the focus back to its chip (GF-98)', async ({ page }) => {
  await seed(page, 'Popesc');
  await board(page, 'Popesc');
  const only = card(page, 'Popesc');
  await expect(only).toBeVisible();
  const pop = page.getByTestId('pop-status');
  const chip = page.getByTestId('chip-status');

  // `esc` from inside the popover: the chip takes the focus back, so `⏎` is the chip's and not the Cursor's
  await page.keyboard.press('j');
  await expect(only).toHaveClass(/is-cursor/);
  await chip.click();
  await expect(page.getByRole('group', { name: 'filter by status' })).toBeFocused();
  // `⌘A` is not a bare key, so it is the board's behind the popover, which stays open and keeps the focus
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('selection-bar')).toContainText('1');
  await expect(pop).toBeVisible();
  await expect(page.getByRole('group', { name: 'filter by status' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(page.getByTestId('selection-bar')).toContainText('1');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
  await expect(page).toHaveURL(/\?q=Popesc$/);

  // the palette takes the focus and hands it back when it closes; the popover is still open, so `esc` is its
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(pop).toBeVisible();
  await expect(page.getByRole('group', { name: 'filter by status' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(page).toHaveURL(/\?q=Popesc$/);
  await expect(chip).toBeFocused();
  await expect(only).toHaveClass(/is-cursor/);
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
  await expect(page).toHaveURL(/\?q=Popesc$/);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
});

test('a held ⏎ on the app chip opens its popover and picks nothing, not the `any` row (GF-98)', async ({ page }) => {
  await board(page, 'Popesc');
  await page.getByTestId('chip-app').click();
  await page.getByTestId('pop-app').getByRole('option', { name: 'Keyboard' }).click();
  await expect(page.getByTestId('chip-app')).toContainText('Keyboard');
  await expect(page).toHaveURL(/app_id=\d+/);
  // a pick by mouse draws no ring, so the focus is not handed to the chip
  await expect(page.locator('body')).toBeFocused();
  await page.getByTestId('chip-app').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('pop-app')).toBeVisible();
  await expect(page.getByTestId('pop-app').getByRole('combobox')).toBeFocused();
  await expect(page.getByTestId('chip-app')).toContainText('Keyboard');
  await expect(page).toHaveURL(/app_id=\d+/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pop-app')).toHaveCount(0);
  await expect(page.getByTestId('chip-app')).toBeFocused();

  // held on a row it picks once; the chip takes the focus and the repeats press nothing
  await page.getByTestId('chip-project').click();
  await page.getByTestId('pop-project').getByRole('combobox').fill('none');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('chip-project')).toContainText('none');
  await expect(page.getByTestId('pop-project')).toHaveCount(0);
  await expect(page.getByTestId('chip-project')).toBeFocused();
  await expect(page).toHaveURL(/project_id=null/);
});

/** An app the pickers can list, through the API so a spec on its own still has one. */
async function seedApp(page: Page, name: string) {
  const response = await page.request.post('/api/apps', { data: { name } });
  expect(response.ok(), await response.text()).toBe(true);
}

test('a reopened picker highlights what is set, so ⏎ ⏎ from its chip keeps the filter, and it starts on `any` only when nothing is (GF-103)', async ({ page }) => {
  await seedApp(page, 'Reopened');
  await seed(page, 'Popreopen');
  await board(page, 'Popreopen');
  const chip = page.getByTestId('chip-app');
  const pop = page.getByTestId('pop-app');

  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(pop.getByRole('option', { name: 'any' })).toHaveAttribute('aria-selected', 'true');
  await pop.getByRole('combobox').fill('Reopened');
  await page.keyboard.press('Enter');
  await expect(chip).toContainText('Reopened');
  await expect(chip).toBeFocused();
  const address = page.url();
  expect(address).toMatch(/app_id=\d+/);

  await page.keyboard.press('Enter');
  await expect(pop.getByRole('option', { name: 'Reopened' })).toHaveAttribute('aria-selected', 'true');
  await expect(pop.getByRole('option', { name: 'any' })).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
  await expect(chip).toContainText('Reopened');
  expect(page.url()).toBe(address);

  // `↓` starts from the highlight, and a query still starts from the top of what it found
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await expect(pop.getByRole('option', { name: 'Reopened' })).toHaveAttribute('aria-selected', 'false');
  await pop.getByRole('combobox').fill('any');
  await expect(pop.getByRole('option', { name: 'any' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(chip).toHaveText('app');
  await expect(page).toHaveURL(/\?q=Popreopen$/);

  // `none` is a value too
  await page.getByTestId('chip-project').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('pop-project').getByRole('combobox').fill('none');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/project_id=null/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pop-project').getByRole('option', { name: 'none' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/project_id=null/);
  await expect(page.getByTestId('chip-project')).toContainText('none');
});

test('⏎ ⏎ on a project chip whose address names no app writes nothing (GF-103)', async ({ page }) => {
  const app = await page.request.post('/api/apps', { data: { name: 'Reopened home' } });
  expect(app.ok(), await app.text()).toBe(true);
  const project = await page.request.post('/api/projects', { data: { name: 'Reopened project', app_id: ((await app.json()) as { id: number }).id } });
  expect(project.ok(), await project.text()).toBe(true);
  const id = ((await project.json()) as { id: number }).id;
  await page.goto(`/?project_id=${id}`);
  const chip = page.getByTestId('chip-project');
  await expect(chip).toContainText('Reopened project');
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pop-project').getByRole('option', { name: 'Reopened project' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pop-project')).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/\\?project_id=${id}$`));
});

test('a reopened picker scrolls what is set into sight (GF-103)', async ({ page }) => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await seedApp(page, `Zlong ${String(n).padStart(2, '0')}`);
  await board(page, 'Popreopen');
  await page.getByTestId('chip-app').click();
  await page.getByTestId('pop-app').getByRole('option', { name: 'Zlong 10' }).click();
  await expect(page.getByTestId('chip-app')).toContainText('Zlong 10');
  await page.getByTestId('chip-app').focus();
  await page.keyboard.press('Enter');
  const set = page.getByTestId('pop-app').getByRole('option', { name: 'Zlong 10' });
  await expect(set).toHaveAttribute('aria-selected', 'true');
  await expect(set).toBeInViewport({ ratio: 0.9 });

  // the armed row stays in sight as a query or `↓` moves it, so `⏎` picks what can be read
  await page.getByTestId('pop-app').getByRole('combobox').fill('zlong 0');
  const first = page.getByTestId('pop-app').getByRole('option', { name: 'Zlong 01' });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toBeInViewport({ ratio: 0.9 });
  for (let n = 0; n < 8; n++) await page.keyboard.press('ArrowDown');
  const ninth = page.getByTestId('pop-app').getByRole('option', { name: 'Zlong 09' });
  await expect(ninth).toHaveAttribute('aria-selected', 'true');
  await expect(ninth).toBeInViewport({ ratio: 0.9 });
  await page.keyboard.press('Escape');

  // the list scrolls, never the page under the press that opened it
  await page.setViewportSize({ width: 390, height: 240 });
  await page.getByTestId('chip-app').click();
  await expect(page.getByTestId('pop-app')).toBeVisible();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('Tab closes a popover and moves on, so `space` toggles no row and the keys are the board\'s again; a click then ↓ then space toggles the highlight (GF-103)', async ({ page }) => {
  await seed(page, 'Poptab');
  await board(page, 'Poptab');
  await page.getByTestId('chip-status').click();
  const group = page.getByRole('group', { name: 'filter by status' });
  await expect(group).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pop-status')).toHaveCount(0);
  await expect(page.getByTestId('chip-status')).not.toBeFocused();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/\?q=Poptab$/);

  await page.goto('/?q=Poptab');
  await page.getByTestId('chip-app').click();
  await expect(page.getByTestId('pop-app').getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pop-app')).toHaveCount(0);
  await expect(page.getByTestId('chip-app')).not.toBeFocused();

  await page.goto('/?q=Poptab');
  await page.getByTestId('chip-status').click();
  await page.getByTestId('check-planning').click();
  await expect(page.getByTestId('check-planning')).not.toBeChecked();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('check-planning')).not.toBeChecked();
  await expect(page.getByTestId('check-ready')).not.toBeChecked();
  await expect(page.getByTestId('check-building')).toBeChecked();
});

test('a popover that lost the focus still holds the bare keys, wherever the focus went, and a field goes on typing (GF-103)', async ({ page }) => {
  await seed(page, 'Poplost');
  await board(page, 'Poplost');
  const only = card(page, 'Poplost');
  await expect(only).toBeVisible();
  const pop = page.getByTestId('pop-app');

  // a press on the popover's own key strip drops the focus to `body`
  await page.getByTestId('chip-app').click();
  await pop.locator('.gf-tile-keys').click();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('j');
  await page.keyboard.press('ArrowDown');
  await expect(only).not.toHaveClass(/is-cursor/);
  // and `Tab` is still the way out
  await page.keyboard.press('Tab');
  await expect(pop).toHaveCount(0);
  await page.getByTestId('chip-app').click();
  await pop.locator('.gf-tile-keys').click();
  await page.keyboard.press('c');
  await page.keyboard.press('x');
  await expect(page.getByTestId('board-create')).toHaveCount(0);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(page.getByTestId('chip-app')).toBeFocused();

  // with a Cursor behind it, `⏎` on `body` does not open the card
  await page.keyboard.press('j');
  await expect(only).toHaveClass(/is-cursor/);
  await page.getByTestId('chip-app').click();
  await pop.locator('.gf-tile-keys').click();
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
  await expect(page).toHaveURL(/\?q=Poplost$/);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(only).toHaveClass(/is-cursor/);

  // the focus on another control: a bare key is still held, a checkbox keeps `space`, that chip still answers `⏎`, and a field still types
  await page.keyboard.press('Escape');
  await expect(only).not.toHaveClass(/is-cursor/);
  await page.getByTestId('chip-status').click();
  const check = page.locator('.gf-card-check input, input.gf-card-check').first();
  await check.focus();
  await page.keyboard.press('j');
  await expect(only).not.toHaveClass(/is-cursor/);
  await page.keyboard.press('Space');
  await expect(check).toBeChecked();
  await expect(page.getByTestId('pop-status')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(check).not.toBeChecked();
  await page.getByTestId('chip-label').focus();
  await page.keyboard.press('j');
  await expect(only).not.toHaveClass(/is-cursor/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pop-label')).toBeVisible();
  await expect(page.getByTestId('pop-status')).toHaveCount(0);
  await page.getByLabel('filter by text').focus();
  await expect(page.getByTestId('pop-label')).toBeVisible();
  await page.keyboard.type('j');
  await expect(page.getByLabel('filter by text')).toHaveValue(/j/);
});

test('`v` over a popover that lost the focus opens nothing newer than it, so `esc` closes what is on top (GF-103)', async ({ page }) => {
  await seed(page, 'Poporder');
  await board(page, 'Poporder');
  await expect(card(page, 'Poporder')).toBeVisible();
  const pop = page.getByTestId('pop-app');
  await page.getByTestId('chip-app').click();
  await pop.locator('.gf-tile-keys').click();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('v');
  await expect(page.getByTestId('view-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(page.getByTestId('view-menu')).toHaveCount(0);
});

test('the view menu opened first closes last, and a popover opened over it closes first (GF-103)', async ({ page }) => {
  await seed(page, 'Popmenu');
  await board(page, 'Popmenu');
  await expect(card(page, 'Popmenu')).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.getByTestId('view-menu')).toBeVisible();
  await page.getByTestId('chip-status').click();
  await expect(page.getByTestId('pop-status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pop-status')).toHaveCount(0);
  await expect(page.getByTestId('view-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-menu')).toHaveCount(0);
});

test('palette esc hands the focus back to what held it, and leaves it on `body` when that is where it was (GF-103)', async ({ page }) => {
  await seed(page, 'Poppal');
  await board(page, 'Poppal');
  await expect(card(page, 'Poppal')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.locator('body')).toBeFocused();

  await page.getByTestId('chip-label').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette').getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('chip-label')).toBeFocused();

  await page.getByTestId('chip-status').click();
  const group = page.getByRole('group', { name: 'filter by status' });
  await expect(group).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(group).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/status=/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pop-status')).toHaveCount(0);
  await expect(page.getByTestId('chip-status')).toBeFocused();
});

test('palette esc leaves the page where it was, and the focus on `body` when what held it has scrolled away (GF-103)', async ({ page }) => {
  const key = await seed(page, 'Popscroll');
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto(`/tickets/${key}`);
  const opener = page.getByTestId('hint-write');
  await opener.focus();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(200);
  await expect(opener).not.toBeInViewport();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
  await expect(page.locator('body')).toBeFocused();
});
