import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GF-114: help that names a key or a mouse gesture says what a finger does on a
 * coarse pointer, and what it says has to work: each test does the thing it read.
 */

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const mine = (title: string) => `${title} (${test.info().project.name})`;

async function create<T>(page: Page, path: string, data: Record<string, unknown>): Promise<T> {
  const response = await page.request.post(path, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}
const ticket = (page: Page, data: Record<string, unknown>) => create<{ key: string }>(page, '/api/tickets', data);
const project = (page: Page, name: string) => create<{ id: number }>(page, '/api/projects', { name });

test('an empty description says to tap, and the tap starts writing', async ({ page }) => {
  await page.goto(`/tickets/${(await ticket(page, { title: mine('Nothing written') })).key}`);
  const field = page.getByTestId('description');
  const help = field.getByText('no description — tap to write');
  await expect(help).toBeVisible();
  await expect(field.getByText('press e')).toBeHidden();

  // the words let a press through to the field under them, so this is the finger on the words themselves
  const box = (await field.locator('.gf-md-placeholder').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(field.locator('.gf-doc')).toBeFocused();
  await expect(help).toBeHidden();
});

test('the graph’s help names what a finger does, and the tap it names opens the ticket', async ({ page }) => {
  const { id } = await project(page, mine('Help graph'));
  const { key } = await ticket(page, { title: mine('Graph help'), project_id: id });
  await page.goto(`/projects/${id}`);
  const tile = page.getByTestId('graph-tile');
  await expect(tile.getByText('Tap a ticket to open it.')).toBeVisible();
  await expect(tile.getByText('drag to pan · pinch to zoom')).toBeVisible();
  // the key to colours only a hover or Tab draws
  await expect(tile.getByText('prerequisites')).toBeHidden();
  // touch-graph.e2e.ts does the drag and the pinch, in Chromium; no version of the help may offer more
  await expect(tile).not.toHaveText(/hover|\btab\b|click|scroll/i, { useInnerText: true });

  await tile.getByTestId(`node-${key}`).tap();
  await expect(page).toHaveURL(new RegExp(`/tickets/${key}`));
});

test('an empty list names the control a finger taps, and the tap opens its form', async ({ page }) => {
  // what was seeded before this spec has to be gone for these lists to be empty, so the answer is stubbed for the two that span the database
  const nothing = (route: { fulfill: (r: { json: unknown }) => Promise<void> }) => route.fulfill({ json: [] });
  await page.route(/\/api\/apps(\?|$)/, nothing);
  await page.goto('/apps');
  const tapButton = (name: string) => page.getByRole('button', { name, exact: true }).tap();
  await expect(page.getByText('no apps yet — tap +')).toBeVisible();
  await tapButton('new app');
  await expect(page.getByLabel('name')).toBeVisible();

  await page.route(/\/api\/projects(\?|$)/, nothing);
  await page.goto('/projects');
  await expect(page.getByText('no projects yet — tap +')).toBeVisible();
  await tapButton('new project');
  await expect(page.getByLabel('name')).toBeVisible();

  await page.route(/\/api\/tickets(\?|$)/, nothing);
  await page.goto('/');
  await expect(page.getByText('no tickets yet — tap new')).toBeVisible();
  await page.getByTestId('hint-new').tap();
  await expect(page.getByTestId('board-create')).toBeVisible();
  await page.unrouteAll();

  const app = await create<{ id: number }>(page, '/api/apps', { name: mine('Help app') });
  await page.goto(`/apps/${app.id}`);
  await expect(page.getByTestId('tickets-tile').getByText('no tickets — tap new')).toBeVisible();
  await expect(page.getByText('no projects — tap +')).toBeVisible();

  await page.goto(`/projects/${(await project(page, mine('Help empty'))).id}`);
  const tickets = page.getByTestId('tickets-tile');
  await expect(tickets.getByText('no tickets — tap new')).toBeVisible();
  // `new` is in the tile above, so the graph has only the fact to give a finger
  await expect(page.getByTestId('graph-tile').getByText('no tickets', { exact: true })).toBeVisible();
  await tickets.getByRole('button', { name: /new/ }).tap();
  await expect(tickets.getByRole('textbox', { name: 'ticket title' })).toBeVisible();
});

test('a field that moved under unsaved words offers a finger `done`, and `done` saves them', async ({ page }) => {
  const { key } = await ticket(page, { title: mine('Moved field'), description: 'origin words' });
  const path = `/api/tickets/${key}`;
  await page.goto(`/tickets/${key}`);

  let refused = false;
  await page.route(path, async (route) => {
    if (route.request().method() !== 'PATCH' || refused) return route.continue();
    refused = true;
    await page.request.patch(path, { data: { description: 'rewritten underneath' } });
    await route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Conflict', hint: 'changed while the edit was being applied' }) });
  });
  const field = page.getByTestId('description');
  await field.locator('.gf-doc').tap();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' mine');
  await page.getByTestId('editor-done').tap();
  const sentence = field.getByRole('alert');
  await expect(sentence).toHaveText('changed elsewhere while unsaved; in the field, done saves yours', { useInnerText: true });

  await field.locator('.gf-doc').tap();
  await page.getByTestId('editor-done').tap();
  await expect(sentence).toHaveCount(0);
  await expect.poll(async () => ((await (await page.request.get(path)).json()) as { description: string }).description).toBe('origin words mine');
});

test('the Start modal says a tap lists the choices, and the tap does', async ({ page }) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-help-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(root, 'branch', 'existing-work');
  const app = await create<{ id: number }>(page, '/api/apps', { name: mine('Help start'), checkout: root });
  const { key } = await ticket(page, { title: mine('Started by tapping'), status: 'ready', simple: true, app_id: app.id });
  await page.goto(`/tickets/${key}`);
  await page.getByTestId('move-start').tap();
  const modal = page.getByTestId('start-modal');
  await expect(modal.getByText('tap a field for its list')).toBeVisible();
  await expect(modal.locator('kbd:visible')).toHaveCount(0);

  // still true once typing has narrowed the list to nothing and the field holds the focus
  await modal.getByLabel('branch').fill('nothing-is-called-this');
  await expect(modal.getByRole('listbox')).toHaveCount(0);
  await expect(modal.getByText('tap a field for its list')).toBeVisible();

  await modal.getByLabel('branch').tap();
  await expect(modal.getByRole('listbox')).toBeVisible();
  await expect(modal.getByText('tap a field for its list')).toHaveCount(0);
  await expect(modal.locator('kbd:visible')).toHaveCount(0);
  await modal.getByRole('option', { name: /existing-work/ }).tap();
  await expect(modal.getByLabel('branch')).toHaveValue('existing-work');

  await page.getByTestId('start-cancel').tap();
  rmSync(root, { recursive: true, force: true });
});

/** A phone or tablet with a keyboard: WebKit's Tab skips a button with no tabindex, and here that would leave the dialog for `body`, where the keys are the page's. */
test('Tab walks the Start modal and stays inside it, fields or no Worktree', async ({ page }) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-tab-')));
  const made = join(root, 'made');
  const fresh = join(root, 'fresh');
  for (const folder of [made, fresh]) {
    mkdirSync(folder);
    git(folder, 'init', '-q', '-b', 'main');
  }
  git(made, 'commit', '-q', '--allow-empty', '-m', 'first');
  const modal = page.getByTestId('start-modal');
  const open = async (checkout: string, name: string) => {
    const app = await create<{ id: number }>(page, '/api/apps', { name: mine(name), checkout });
    const { key } = await ticket(page, { title: mine(`${name} by keys`), status: 'ready', simple: true, app_id: app.id });
    await page.goto(`/tickets/${key}`);
    await page.getByTestId('move-start').tap();
  };

  await open(made, 'Tab fields');
  await expect(modal.getByLabel('branch')).toBeFocused();
  await expect(modal.getByLabel('base')).toBeVisible();
  for (const stop of [modal.getByLabel('base'), modal.getByTestId('start-go'), modal.getByTestId('start-cancel'), modal.getByLabel('branch')]) {
    await page.keyboard.press('Tab');
    await expect(stop).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await open(fresh, 'Tab nothing');
  await expect(modal.getByTestId('start-cancel')).toBeFocused();
  for (const stop of [modal.getByTestId('start-plain'), modal.getByTestId('start-app-link'), modal.getByTestId('start-cancel')]) {
    await page.keyboard.press('Shift+Tab');
    await expect(stop).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  rmSync(root, { recursive: true, force: true });
});
