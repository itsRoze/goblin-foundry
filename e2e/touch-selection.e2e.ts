import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 03b by finger alone, on the stacked phone board in both engines:
 * selecting, clearing, selecting all, every bulk action and both questions —
 * and their cancels — reached by a visible control. Nothing here presses a
 * key. A tap on a card still opens it; a tap on its checkbox never does.
 */

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });
const box = (page: Page, key: string) => page.getByTestId(`select-${key}`);
const count = (page: Page) => page.getByTestId('selection-count');

/**
 * Both engines run over one database, so what each makes is named for the engine that made it — in front, so a
 * title's first words are also the `?q=` that narrows the board to this engine's tickets.
 */
const mine = (title: string) => `${test.info().project.name} ${title}`;

let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: `Touch selection ${Math.random()}` } });
  appId = ((await response.json()) as { id: number }).id;
});

async function seed(page: Page, title: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await page.request.post('/api/tickets', { data: { title, app_id: appId, simple: true, ...body } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { key: string }).key;
}

const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; app_id: number | null; project_id: number | null };

const board = async (page: Page, q: string) => {
  await page.goto(`/?q=${encodeURIComponent(q)}`);
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'vertical');
};

test('a checkbox selects by tap, select all and clear are controls, and tapping a card still opens it', async ({ page }) => {
  const one = await seed(page, mine('Tapped pick one'), { status: 'planning' });
  await seed(page, mine('Tapped pick two'), { status: 'planning' });
  await board(page, mine('Tapped pick'));
  await expect(card(page, mine('Tapped pick one'))).toBeVisible();

  await box(page, one).tap();
  await expect(count(page)).toHaveText('1 selected');
  await expect(page.getByTestId('board')).toBeVisible();
  // the checkbox is a finger-sized target and the bar stays inside the phone
  const target = await box(page, one).boundingBox();
  expect(Math.min(target!.width, target!.height)).toBeGreaterThanOrEqual(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTestId('select-all').tap();
  await expect(count(page)).toHaveText('2 selected');
  await page.getByTestId('clear-selection').tap();
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await page.getByTestId('hint-select-all').tap();
  await expect(count(page)).toBeVisible();
  await page.getByTestId('clear-selection').tap();

  await card(page, mine('Tapped pick one')).tap();
  await expect(page.getByTestId('about-tile')).toBeVisible();
});

test('a folded section’s tickets are selected, counted and acted on; trash asks with the whole count and cancel sends nothing', async ({ page }) => {
  const open = await seed(page, mine('Folded set open'), { status: 'planning' });
  const folded = await seed(page, mine('Folded set hidden'), { status: 'todo' });
  await board(page, mine('Folded set'));
  await expect(card(page, mine('Folded set open'))).toBeVisible();
  await expect(card(page, mine('Folded set hidden'))).toHaveCount(0);

  await page.getByTestId('hint-select-all').tap();
  await expect(count(page)).toHaveText('2 selected');
  // folding the open section takes nothing out of the Selection
  await page.getByTestId('section-head-planning').tap();
  await expect(card(page, mine('Folded set open'))).toHaveCount(0);
  await expect(count(page)).toHaveText('2 selected');
  await page.getByTestId('section-head-planning').tap();

  await page.getByTestId('bulk-trash').tap();
  await expect(page.getByTestId('bulk-confirm')).toContainText('Trash 2 Tickets?');
  await page.getByTestId('bulk-confirm-cancel').tap();
  await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);
  await expect(count(page)).toHaveText('2 selected');
  expect((await page.request.get(`/api/tickets/${folded}`)).status()).toBe(200);

  // todo and planning share `approve`: one tap, both tickets, the folded one included
  await page.getByTestId('bulk-approve').tap();
  await expect(page.getByTestId('bulk-done')).toHaveText('Approved 2 Tickets');
  expect((await read(page, open)).status).toBe('ready');
  expect((await read(page, folded)).status).toBe('ready');
  await expect(page.getByTestId('selection-count')).toHaveCount(0);
});

test('status, move and trash are all reached from the bar by tapping', async ({ page }) => {
  // made before the page loads: the palette offers the projects the page already knows
  const project = (await (await page.request.post('/api/projects', { data: { name: mine('Landing'), app_id: appId } })).json()) as { id: number };
  const a = await seed(page, mine('Barred alpha'), { status: 'planning' });
  const b = await seed(page, mine('Barred bravo'), { status: 'planning' });
  await board(page, mine('Barred'));
  await expect(card(page, mine('Barred alpha'))).toBeVisible();

  await page.getByTestId('hint-select-all').tap();
  await page.getByTestId('bulk-status').tap();
  await page.getByTestId('palette').getByTestId('run-move-shelve').tap();
  await expect(page.getByTestId('bulk-done')).toHaveText('Shelved 2 Tickets');
  expect((await read(page, a)).status).toBe('backlog');

  // to a project, through the nested pick, by tap: the project brings its app
  await page.getByTestId('hint-select-all').tap();
  await page.getByTestId('bulk-move').tap();
  await page.getByTestId('palette').getByTestId('run-act-move-project').tap();
  // eight rows is what stays a menu, and both engines have made projects by now: the name narrows it
  await page.getByTestId('palette').getByLabel('command palette').fill(mine('Landing'));
  await page.getByTestId('palette').getByRole('option', { name: mine('Landing') }).tap();
  await expect(page.getByTestId('bulk-done')).toHaveText('Moved 2 Tickets');
  expect(await read(page, a)).toMatchObject({ app_id: appId, project_id: project.id });

  await page.getByTestId('hint-select-all').tap();
  await page.getByTestId('bulk-move').tap();
  await page.getByTestId('palette').getByTestId('run-act-nowhere').tap();
  await expect(page.getByTestId('bulk-done')).toHaveText('Moved 2 Tickets');
  expect((await read(page, b)).app_id).toBeNull();

  // with no app they cannot be approved: the refusal names them, nothing moves, and `×` puts it away
  await page.getByTestId('hint-select-all').tap();
  await page.getByTestId('bulk-approve').tap();
  await expect(page.getByTestId('bulk-refused')).toContainText('Nothing changed');
  await expect(page.getByTestId('bulk-refused')).toContainText('a ticket in backlog does not go to ready');
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  await page.getByTestId('bulk-dismiss').tap();
  await expect(page.getByTestId('bulk-refused')).toHaveCount(0);
  await page.getByTestId('clear-selection').tap();

  await page.getByTestId('hint-select-all').tap();
  await page.getByTestId('bulk-trash').tap();
  await page.getByTestId('bulk-confirm-yes').tap();
  await expect(page.getByTestId('bulk-done')).toHaveText('Trashed 2 Tickets');
  expect((await page.request.get(`/api/tickets/${a}`)).status()).toBe(404);
  expect((await page.request.get(`/api/tickets/${b}`)).status()).toBe(404);
});

test('starting a blocked ticket asks once, by name; cancel holds the batch and yes sends it', async ({ page }) => {
  const blocker = await seed(page, mine('Finger blocker'));
  const held = await seed(page, mine('Finger start held'), { status: 'ready' });
  const free = await seed(page, mine('Finger start free'), { status: 'ready' });
  await page.request.post(`/api/tickets/${held}/dependencies`, { data: { blocker } });
  await board(page, mine('Finger start'));
  await expect(card(page, mine('Finger start held'))).toBeVisible();

  await box(page, held).tap();
  await box(page, free).tap();
  await page.getByTestId('bulk-status').tap();
  await page.getByTestId('palette').getByTestId('run-move-start').tap();
  await expect(page.getByTestId('bulk-confirm-lines')).toContainText(`${held} is blocked by ${blocker}`);
  await page.getByTestId('bulk-confirm-cancel').tap();
  expect((await read(page, free)).status).toBe('ready');
  await expect(count(page)).toHaveText('2 selected');

  await page.getByTestId('bulk-status').tap();
  await page.getByTestId('palette').getByTestId('run-move-start').tap();
  await page.getByTestId('bulk-confirm-yes').tap();
  await expect(page.getByTestId('bulk-done')).toHaveText('Started 2 Tickets');
  expect((await read(page, held)).status).toBe('building');
  expect((await read(page, free)).status).toBe('building');
});
