import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 03b: a Selection gathered by checkbox, key and range, and one
 * all-or-none action on it. Named to sort late — one worker shares one
 * database — and every board here is narrowed with `?q=` to the tickets the
 * test made, which is also what makes "select all" a statement about the
 * Filter rather than about the fixture. The titles are coined words for that
 * reason: `q` is a substring match over every ticket the earlier specs left
 * behind, and `Tick` finds every "ticket" among them.
 */

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });
const box = (page: Page, key: string) => page.getByTestId(`select-${key}`);
const count = (page: Page) => page.getByTestId('selection-count');
const bar = (page: Page) => page.getByTestId('selection-bar');
/** The board narrowed to `q`, with its cards drawn: a key pressed before they are has nothing to land on. */
const board = async (page: Page, q: string) => {
  await page.goto(`/?q=${encodeURIComponent(q)}`);
  await expect(page.locator('[data-testid^="card-"]').first()).toBeVisible();
};

interface Seeded {
  id: number;
  key: string;
}

let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: 'Selection' } });
  appId = ((await response.json()) as { id: number }).id;
});

/** A ticket straight from the API; simple and in an app unless told otherwise, so the approve guard is met. */
async function seed(page: Page, title: string, body: Record<string, unknown> = {}): Promise<Seeded> {
  const response = await page.request.post('/api/tickets', { data: { title, app_id: appId, simple: true, ...body } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Seeded;
}

const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; app_id: number | null; project_id: number | null; title: string };
const history = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}/events`)).json()) as unknown[];

test('a checkbox selects without opening, the count says how many, and the Cursor is a different thing', async ({ page }) => {
  const a = await seed(page, 'Tickbox alpha');
  const b = await seed(page, 'Tickbox bravo');
  await board(page, 'Tickbox ');

  await expect(bar(page)).toHaveCount(0);
  await box(page, a.key).check();
  await expect(page).toHaveURL(/\?q=Tickbox/);
  await expect(count(page)).toHaveText('1 selected');
  await expect(card(page, 'Tickbox alpha')).toHaveClass(/is-selected/);
  // selecting is not pointing: no card has the Cursor yet
  await expect(page.locator('.gf-card.is-cursor')).toHaveCount(0);

  // `j` puts the Cursor on the first card and `j` again on the second; `x` ticks the one it is on
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(card(page, 'Tickbox bravo')).toHaveClass(/is-cursor/);
  await page.keyboard.press('x');
  await expect(box(page, b.key)).toBeChecked();
  await expect(count(page)).toHaveText('2 selected');
  // moving the Cursor away changes nothing about the Selection
  await page.keyboard.press('k');
  await expect(count(page)).toHaveText('2 selected');
  await page.keyboard.press('x');
  await expect(box(page, a.key)).not.toBeChecked();
  await expect(count(page)).toHaveText('1 selected');

  // a plain click still opens the ticket
  await card(page, 'Tickbox alpha').click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
});

test('shift-click gathers a range in lifecycle order across columns, redraws it from the same anchor, and leaves other picks alone', async ({ page }) => {
  const one = await seed(page, 'Shiftrange one');
  const two = await seed(page, 'Shiftrange two');
  const three = await seed(page, 'Shiftrange three', { status: 'todo' });
  const four = await seed(page, 'Shiftrange four', { status: 'planning' });
  const five = await seed(page, 'Shiftrange five', { status: 'planning' });
  await board(page, 'Shiftrange ');

  // with no anchor, shift-click selects that card and goes nowhere
  await card(page, 'Shiftrange two').click({ modifiers: ['Shift'] });
  await expect(page).toHaveURL(/\?q=Shiftrange/);
  await expect(count(page)).toHaveText('1 selected');

  // an independent pick far away, then a new anchor
  await box(page, five.key).check();
  await box(page, one.key).check();
  await card(page, 'Shiftrange four').click({ modifiers: ['Shift'] });
  for (const t of [one, two, three, four, five]) await expect(box(page, t.key)).toBeChecked();

  // the same anchor, a nearer end: the range contracts, and `five` — picked on its own — stays
  await card(page, 'Shiftrange two').click({ modifiers: ['Shift'] });
  await expect(box(page, one.key)).toBeChecked();
  await expect(box(page, two.key)).toBeChecked();
  await expect(box(page, three.key)).not.toBeChecked();
  await expect(box(page, four.key)).not.toBeChecked();
  await expect(box(page, five.key)).toBeChecked();
  await expect(count(page)).toHaveText('3 selected');
});

test('⇧↓ and ⇧↑ extend and contract a range from the keyboard, across a column end, and the Cursor rides its far end', async ({ page }) => {
  const one = await seed(page, 'Shiftarrow one');
  const two = await seed(page, 'Shiftarrow two');
  const three = await seed(page, 'Shiftarrow three', { status: 'todo' });
  await board(page, 'Shiftarrow ');

  await page.keyboard.press('j');
  await expect(card(page, 'Shiftarrow one')).toHaveClass(/is-cursor/);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(count(page)).toHaveText('2 selected');
  await expect(card(page, 'Shiftarrow two')).toHaveClass(/is-cursor/);
  // off the bottom of backlog and on into todo: the order a range runs in
  await page.keyboard.press('Shift+ArrowDown');
  await expect(box(page, three.key)).toBeChecked();
  await expect(card(page, 'Shiftarrow three')).toHaveClass(/is-cursor/);
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(count(page)).toHaveText('1 selected');
  await expect(box(page, one.key)).toBeChecked();
  await expect(box(page, two.key)).not.toBeChecked();
});

test('⌘A and the visible control select the whole filtered board; a field keeps its own keys', async ({ page }) => {
  await seed(page, 'Wholeboard one');
  await seed(page, 'Wholeboard two', { status: 'planning' });
  await seed(page, 'Not this lot');
  await board(page, 'Wholeboard ');

  await page.keyboard.press('ControlOrMeta+a');
  await expect(count(page)).toHaveText('2 selected');
  await page.getByTestId('clear-selection').click();
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId('hint-select-all').click();
  await expect(count(page)).toHaveText('2 selected');
  await page.getByTestId('clear-selection').click();

  // in the filter's text field `x` is a letter and ⌘A selects the text
  await page.keyboard.press('j');
  await page.keyboard.press('f');
  const find = page.getByLabel('filter by text');
  await expect(find).toBeFocused();
  await page.keyboard.type('x');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await expect(find).toHaveValue('');
});

test('esc closes what is open, then lets the Selection go, then the Cursor', async ({ page }) => {
  const t = await seed(page, 'Escape ladder');
  await board(page, 'Escape ladder');
  await page.keyboard.press('j');
  await expect(card(page, 'Escape ladder')).toHaveClass(/is-cursor/);
  await page.keyboard.press('x');
  await expect(box(page, t.key)).toBeChecked();
  await page.keyboard.press('v');
  await expect(page.getByTestId('view-menu')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-menu')).toHaveCount(0);
  await expect(box(page, t.key)).toBeChecked();

  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(card(page, 'Escape ladder')).toHaveClass(/is-cursor/);

  await page.keyboard.press('Escape');
  await expect(card(page, 'Escape ladder')).not.toHaveClass(/is-cursor/);
});

test('a Selection survives a poll and a trip into a ticket, follows the Filter, and does not survive a reload', async ({ page }) => {
  const stays = await seed(page, 'Selcycle stays');
  const leaves = await seed(page, 'Selcycle leaves');
  await board(page, 'Selcycle ');
  await box(page, stays.key).check();
  await box(page, leaves.key).check();

  // the poll: a write from elsewhere shows up, and the Selection is still what it was
  await page.request.patch(`/api/tickets/${stays.key}`, { data: { title: 'Selcycle stays put' } });
  await expect(card(page, 'Selcycle stays put')).toBeVisible({ timeout: 8_000 });
  await expect(count(page)).toHaveText('2 selected');

  await card(page, 'Selcycle stays put').click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(count(page)).toHaveText('2 selected');

  // a ticket the Filter no longer holds leaves the Selection — and does not come back with the Filter
  await page.goto('/?q=Selcycle');
  await box(page, stays.key).check();
  await box(page, leaves.key).check();
  await page.keyboard.press('f');
  await page.getByLabel('filter by text').fill('Selcycle stays');
  await expect(card(page, 'Selcycle leaves')).toHaveCount(0);
  await expect(count(page)).toHaveText('1 selected');
  await page.getByLabel('filter by text').fill('Selcycle');
  await expect(card(page, 'Selcycle leaves')).toBeVisible();
  await expect(box(page, leaves.key)).not.toBeChecked();
  await expect(count(page)).toHaveText('1 selected');

  await page.reload();
  await expect(card(page, 'Selcycle leaves')).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test('three tickets move to a project together; one ineligible ticket stops an approval for all, and fixing it lets all through', async ({ page }) => {
  const project = (await (await page.request.post('/api/projects', { data: { name: 'Bulk landing', app_id: appId } })).json()) as { id: number };
  const a = await seed(page, 'Bulkaccept alpha', { status: 'todo', app_id: null });
  const b = await seed(page, 'Bulkaccept bravo', { status: 'planning', app_id: null });
  const c = await seed(page, 'Bulkaccept charlie', { status: 'todo', app_id: null, simple: false });
  await board(page, 'Bulkaccept ');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(count(page)).toHaveText('3 selected');

  // the palette addresses the set, says so, and offers nothing that is about one ticket
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByTestId('palette');
  await expect(palette).toContainText('actions · 3 Tickets');
  await expect(palette.getByTestId('run-act-simple')).toHaveCount(0);
  await expect(palette.getByTestId('run-act-blocked-by')).toHaveCount(0);
  // an empty palette is a menu shared between its groups; naming the row is how you reach the ninth action
  await palette.getByLabel('command palette').fill('move to pro');
  await palette.getByTestId('run-act-move-project').click();
  await palette.getByRole('option', { name: 'Bulk landing' }).click();
  await expect(page.getByTestId('bulk-done')).toHaveText('Moved 3 Tickets');
  await expect(count(page)).toHaveCount(0);
  for (const t of [a, b, c]) expect(await read(page, t.key)).toMatchObject({ app_id: appId, project_id: project.id });
  await expect(card(page, 'Bulkaccept alpha')).toContainText('Selection / Bulk landing');

  // `charlie` has no design and is not simple: `a` refuses the set, names it, and nothing moves
  await page.keyboard.press('ControlOrMeta+a');
  await expect(count(page)).toHaveText('3 selected');
  const before = await Promise.all([a, b, c].map((t) => history(page, t.key)));
  await page.keyboard.press('a');
  const refused = page.getByTestId('bulk-refused');
  await expect(refused).toContainText('Nothing changed');
  await expect(refused).toContainText(c.key);
  await expect(refused).toContainText('approve needs a ticket design');
  expect((await read(page, a.key)).status).toBe('todo');
  expect((await read(page, b.key)).status).toBe('planning');
  expect(await Promise.all([a, b, c].map((t) => history(page, t.key)))).toEqual(before);
  await expect(count(page)).toHaveText('3 selected');

  // fixed from elsewhere; the same Selection now goes through whole
  await page.request.patch(`/api/tickets/${c.key}`, { data: { design: 'the plan' } });
  await expect(async () => {
    await page.getByTestId('bulk-approve').click();
    await expect(page.getByTestId('bulk-done')).toHaveText('Approved 3 Tickets', { timeout: 1_000 });
  }).toPass();
  await expect(bar(page).getByTestId('selection-count')).toHaveCount(0);
  for (const t of [a, b, c]) expect((await read(page, t.key)).status).toBe('ready');
});

test('the API’s refusal is reported the same way when the board could not see it coming', async ({ page }) => {
  const ready = await seed(page, 'Server says no', { status: 'ready' });
  const idea = await seed(page, 'Server says also');
  await board(page, 'Server says');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('bulk-move').click();
  await page.getByTestId('palette').getByTestId('run-act-nowhere').click();
  const refused = page.getByTestId('bulk-refused');
  await expect(refused).toContainText('Nothing changed');
  await expect(refused).toContainText(`${ready.key}a ticket in ready needs an app — unapprove it first`);
  expect((await read(page, idea.key)).app_id).toBe(appId);
  await expect(count(page)).toHaveText('2 selected');
  await page.getByTestId('bulk-dismiss').click();
  await expect(refused).toHaveCount(0);
});

test('s and d know about the Selection, and a card’s own menu still means that card', async ({ page }) => {
  const a = await seed(page, 'Bulktarget alpha', { status: 'todo' });
  const b = await seed(page, 'Bulktarget bravo', { status: 'planning' });
  const other = await seed(page, 'Bulktarget other', { status: 'todo' });
  await board(page, 'Bulktarget ');
  await box(page, a.key).check();
  await box(page, b.key).check();
  // the Cursor sits on a third card: the keys must not mean it
  await page.keyboard.press('j');
  await expect(card(page, 'Bulktarget alpha')).toHaveClass(/is-cursor/);

  await page.keyboard.press('d');
  await expect(page.getByTestId('bulk-said')).toContainText('one ticket');
  await expect(page).toHaveURL(/\?q=Bulktarget/);

  await page.keyboard.press('s');
  const palette = page.getByTestId('palette');
  await expect(palette.getByLabel('command palette')).toHaveAttribute('placeholder', 'move 2 Tickets');
  // todo and planning share `approve`, `shelve`, `close`, `cancel` — and not `plan` or `pick`
  await expect(palette.getByTestId('run-move-approve')).toBeVisible();
  await expect(palette.getByTestId('run-move-plan')).toHaveCount(0);
  await palette.getByTestId('run-move-shelve').click();
  await expect(page.getByTestId('bulk-done')).toHaveText('Shelved 2 Tickets');
  expect((await read(page, a.key)).status).toBe('backlog');
  expect((await read(page, b.key)).status).toBe('backlog');

  // a card's `⋯` is about that card, Selection or no
  await box(page, a.key).check();
  await page.getByTestId(`menu-${other.key}`).click();
  await page.getByTestId(`menu-${other.key}-plan`).click();
  await expect.poll(async () => (await read(page, other.key)).status).toBe('planning');
  expect((await read(page, a.key)).status).toBe('backlog');
  await expect(count(page)).toHaveText('1 selected');
});

test('trash asks once with the whole count; cancel sends nothing; a changed set withdraws the question', async ({ page }) => {
  const a = await seed(page, 'Bulkbinned alpha');
  const b = await seed(page, 'Bulkbinned bravo');
  await board(page, 'Bulkbinned ');
  let sent = 0;
  await page.route('**/api/tickets/bulk', (route) => {
    sent += 1;
    return route.continue();
  });
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('bulk-trash').click();
  const confirm = page.getByTestId('bulk-confirm');
  await expect(confirm).toContainText('Trash 2 Tickets?');
  // named, and told the trash is the undo; while it asks, no other verb is in reach
  await expect(page.getByTestId('bulk-confirm-lines')).toContainText(`${a.key} ${b.key}`);
  await expect(page.getByTestId('bulk-confirm-lines')).toContainText('restored from the trash');
  await expect(page.getByTestId('bulk-trash')).toHaveCount(0);
  await page.getByTestId('bulk-confirm-cancel').click();
  await expect(confirm).toHaveCount(0);
  await expect(count(page)).toHaveText('2 selected');

  // asked again, then the set changes under it: the question is about a set that no longer exists
  await page.getByTestId('bulk-trash').click();
  await expect(confirm).toBeVisible();
  await box(page, b.key).uncheck();
  await expect(confirm).toHaveCount(0);
  expect(sent).toBe(0);
  expect((await page.request.get(`/api/tickets/${a.key}`)).status()).toBe(200);

  await box(page, b.key).check();
  await page.getByTestId('bulk-trash').click();
  await page.getByTestId('bulk-confirm-yes').click();
  await expect(page.getByTestId('bulk-done')).toHaveText('Trashed 2 Tickets');
  expect(sent).toBe(1);
  expect((await page.request.get(`/api/tickets/${a.key}`)).status()).toBe(404);
  expect((await page.request.get(`/api/tickets/${b.key}`)).status()).toBe(404);
});

test('start asks once about blockers, keeps the question current, ignores a retitle, and holds the whole batch until yes', async ({ page }) => {
  const blocker = await seed(page, 'Holdup blocker');
  const second = await seed(page, 'Holdup second blocker');
  const free = await seed(page, 'Bulkstart free', { status: 'ready' });
  const held = await seed(page, 'Bulkstart held', { status: 'ready' });
  await page.request.post(`/api/tickets/${held.key}/dependencies`, { data: { blocker: blocker.key } });
  await board(page, 'Bulkstart ');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(count(page)).toHaveText('2 selected');
  await page.keyboard.press('s');
  await page.getByTestId('palette').getByTestId('run-move-start').click();

  const confirm = page.getByTestId('bulk-confirm');
  await expect(confirm).toContainText('1 Ticket of 2 still has open blockers');
  const lines = page.getByTestId('bulk-confirm-lines');
  await expect(lines).toContainText(`${held.key} is blocked by ${blocker.key}`);
  expect((await read(page, free.key)).status).toBe('ready');

  // an unrelated edit leaves the question standing; a new blocker rewrites it
  await page.request.patch(`/api/tickets/${free.key}`, { data: { title: 'Bulkstart free, renamed' } });
  await expect(card(page, 'Bulkstart free, renamed')).toBeVisible({ timeout: 8_000 });
  await expect(confirm).toBeVisible();
  await page.request.post(`/api/tickets/${held.key}/dependencies`, { data: { blocker: second.key } });
  await expect(lines).toContainText(`${held.key} is blocked by ${blocker.key}, ${second.key}`, { timeout: 8_000 });

  await page.getByTestId('bulk-confirm-yes').click();
  await expect(page.getByTestId('bulk-done')).toHaveText('Started 2 Tickets');
  expect((await read(page, free.key)).status).toBe('building');
  expect((await read(page, held.key)).status).toBe('building');
});

test('a submitted action freezes its set, locks those tickets wherever they are viewed, and survives navigation', async ({ page }) => {
  const a = await seed(page, 'Bulkpending alpha', { status: 'todo' });
  const b = await seed(page, 'Bulkpending bravo', { status: 'todo' });
  await board(page, 'Bulkpending ');
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/tickets/bulk', async (route) => {
    await held;
    await route.continue();
  });

  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('bulk-approve').click();
  await expect(page.getByTestId('bulk-pending')).toHaveText('Approving 2 Tickets…');
  // frozen: no selection changes, no second action, and no other write to a held ticket
  await expect(box(page, a.key)).toBeDisabled();
  await expect(page.getByTestId('bulk-trash')).toBeDisabled();
  await expect(page.getByTestId(`menu-${a.key}`)).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(count(page)).toHaveText('2 selected');

  // in-app navigation is free, the action is still out, and the ticket view refuses to write to a held ticket
  await card(page, 'Bulkpending alpha').click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await expect(page.getByTestId('bulk-pending')).toHaveText('Approving 2 Tickets…');
  await page.keyboard.press('a');
  await expect(page.getByTestId('state-tile')).toContainText(`${a.key} is held by a bulk action`);
  expect((await read(page, a.key)).status).toBe('todo');

  release();
  await expect(page.getByTestId('bulk-done')).toHaveText('Approved 2 Tickets');
  await expect(page.getByTestId('state-tile')).toContainText('ready');
  expect((await read(page, b.key)).status).toBe('ready');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('selection-count')).toHaveCount(0);
});

test('a response that never arrives is an unknown outcome: said as such, the board refreshed, and nothing sent twice', async ({ page }) => {
  const a = await seed(page, 'Bulklost alpha', { status: 'todo' });
  await seed(page, 'Bulklost bravo', { status: 'todo' });
  await board(page, 'Bulklost ');
  let sent = 0;
  // the request reaches the API and commits; it is the answer that is lost
  await page.route('**/api/tickets/bulk', async (route) => {
    sent += 1;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('bulk-approve').click();

  const unknown = page.getByTestId('bulk-unknown');
  await expect(unknown).toContainText("Couldn't confirm the outcome");
  await expect(unknown).not.toContainText('Nothing changed');
  // the refresh shows what actually happened
  await expect(page.getByTestId('col-ready').getByText('Bulklost alpha')).toBeVisible();
  expect((await read(page, a.key)).status).toBe('ready');
  // "never sent again" is a negative: the refresh above has come and gone, and a retry would have followed the
  // failure at once, so a short quiet spell with still one request is the evidence there is
  await page.waitForTimeout(500);
  expect(sent).toBe(1);
});

test('an error from something in between is not the API’s answer, and is never read as "Nothing changed"', async ({ page }) => {
  await seed(page, 'Bulkproxy alpha', { status: 'todo' });
  await board(page, 'Bulkproxy ');
  // a bare 502: no problem document, so nothing is known about whether the batch committed
  await page.route('**/api/tickets/bulk', (route) => route.fulfill({ status: 502, body: '' }));
  await page.keyboard.press('ControlOrMeta+a');
  await expect(count(page)).toHaveText('1 selected');
  await page.getByTestId('bulk-approve').click();
  await expect(page.getByTestId('bulk-unknown')).toContainText("Couldn't confirm the outcome");
  await expect(page.getByTestId('bulk-refused')).toHaveCount(0);
  await expect(count(page)).toHaveText('1 selected');
});

test('a Selection rides through a change of orientation and a scroll, folded tickets and all', async ({ page }) => {
  const open = await seed(page, 'Bulkturn open', { status: 'planning' });
  const folded = await seed(page, 'Bulkturn folded');
  await board(page, 'Bulkturn ');
  await box(page, open.key).check();
  await box(page, folded.key).check();
  await expect(count(page)).toHaveText('2 selected');

  // the window narrows to a phone's: the columns stack, backlog folds away, and the Selection is what it was
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'vertical');
  await expect(card(page, 'Bulkturn folded')).toHaveCount(0);
  await expect(count(page)).toHaveText('2 selected');
  await page.mouse.wheel(0, 600);
  await expect(count(page)).toBeInViewport();
  await expect(count(page)).toHaveText('2 selected');

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'horizontal');
  await expect(box(page, open.key)).toBeChecked();
  await expect(box(page, folded.key)).toBeChecked();
});

test('a card’s own blocked-start question cannot write to a ticket a bulk action has since taken hold of', async ({ page }) => {
  const blocker = await seed(page, 'Bulkheld blocker');
  const held = await seed(page, 'Bulkheld ready', { status: 'ready' });
  await page.request.post(`/api/tickets/${held.key}/dependencies`, { data: { blocker: blocker.key } });
  await board(page, 'Bulkheld ');
  // the card's menu asks its own question first…
  await page.getByTestId(`menu-${held.key}`).click();
  await page.getByTestId(`menu-${held.key}-start`).click();
  await expect(page.getByTestId('confirm-ready')).toBeVisible();
  // …then a bulk action takes the ticket and does not answer yet
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/tickets/bulk', async (route) => {
    await waiting;
    await route.continue();
  });
  await box(page, held.key).check();
  await page.getByTestId('bulk-status').click();
  await page.getByTestId('palette').getByTestId('run-move-unapprove').click();
  await expect(page.getByTestId('bulk-pending')).toBeVisible();

  await page.getByTestId('confirm-ready-yes').click();
  await expect(page.getByTestId('refusal-ready')).toContainText(`${held.key} is held by a bulk action`);
  expect((await read(page, held.key)).status).toBe('ready');
  release();
  await expect(page.getByTestId('bulk-done')).toHaveText('Unapproved 1 Ticket');
});
