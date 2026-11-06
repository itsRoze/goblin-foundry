import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NONE = 'the terminal step is none, so no terminal was opened';

/**
 * GF-122: Open terminal on a `building` or `review` Ticket, and what a terminal
 * that did not open looks like, against a temporary Checkout with the `none`
 * step the e2e server runs. Named to run after the desktop specs, whose app
 * lists these Apps would crowd.
 */
test.describe('Open terminal', () => {
  let root: string;
  let repo: string;
  let worktrees: string;
  let appId: number;
  let n = 0;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

  const ready = async (page: Page, title: string, app: number = appId) => {
    const res = await page.request.post('/api/tickets', { data: { title, status: 'ready', simple: true, app_id: app } });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { key: string }).key;
  };
  /** Started the way an agent starts one: in flight, with nowhere recorded. */
  const plainlyStarted = async (page: Page, title: string, app: number = appId) => {
    const key = await ready(page, title, app);
    expect((await page.request.post(`/api/tickets/${key}/start`)).status()).toBe(200);
    return key;
  };
  /** In flight with its Worktree, and the folder it is in. */
  const started = async (page: Page, title: string) => {
    const key = await ready(page, title);
    const res = await page.request.post(`/api/tickets/${key}/start`, { data: {} });
    expect(res.status()).toBe(200);
    return { key, folder: ((await res.json()) as { worktree_folder: string }).worktree_folder };
  };
  const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; worktree_branch: string | null; worktree_folder: string | null };
  const historyOf = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}/events`)).json()) as unknown[];
  const modal = (page: Page) => page.getByTestId('start-modal');
  const said = (page: Page) => page.getByTestId('terminal-said');

  test.beforeAll(async ({ request }) => {
    // real, because git answers with where a folder actually is and macOS's temp dir is a symlink
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-terminal-')));
    repo = join(root, 'subway-reader');
    worktrees = join(root, 'worktrees');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    const home = await request.post('/api/apps', { data: { name: 'Terminal App', checkout: repo } });
    appId = ((await home.json()) as { id: number }).id;
    expect((await request.patch('/api/settings', { data: { worktree_root: worktrees } })).ok()).toBe(true);
  });
  test.afterAll(async ({ request }) => {
    rmSync(root, { recursive: true, force: true });
    // the database is shared, and the next spec reads the setting as a fresh installation has it
    expect((await request.patch('/api/settings', { data: { worktree_root: '~/.goblin/worktrees' } })).ok()).toBe(true);
  });
  test.beforeEach(() => {
    n += 1;
  });

  test('a Start whose terminal did not open says why in place, with the folder to copy, and the Ticket is building', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const title = `Start says ${n}`;
    const key = await ready(page, title);
    const folder = join(worktrees, 'subway-reader', `${key.toLowerCase()}-start-says-${n}`);
    await page.goto(`/tickets/${key}`);
    await expect(said(page)).toHaveCount(0);
    await page.getByTestId('move-start').click();
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);

    await expect(said(page)).toContainText(NONE);
    await expect(said(page).getByTestId('terminal-folder')).toHaveText(folder);
    expect((await read(page, key)).status).toBe('building');

    // the keyboard is already there: the copy took the focus once the modal had gone, and `⏎` copies
    const copy = said(page).getByRole('button', { name: 'copy folder of this terminal' });
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(copy).toHaveText('copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(folder);

    // it is a line, with no timer since it carries a button, and it goes the way a board's notice goes
    await page.keyboard.press('Escape');
    await expect(said(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/tickets/${key}$`));
    await expect(page.getByTestId('open-terminal')).toBeFocused();
  });

  test('a building or review Ticket offers Open terminal where a ready one offers Start, and it moves nothing', async ({ page }) => {
    const waiting = await ready(page, `Not yet ${n}`);
    await page.goto(`/tickets/${waiting}`);
    await expect(page.getByTestId('move-start')).toBeVisible();
    await expect(page.getByTestId('open-terminal')).toHaveCount(0);

    const { key, folder } = await started(page, `Offers it ${n}`);
    await page.goto(`/tickets/${key}`);
    const before = await historyOf(page, key);
    await page.getByTestId('open-terminal').click();
    await expect(said(page)).toContainText(NONE);
    await expect(said(page).getByTestId('terminal-folder')).toHaveText(folder);
    expect((await read(page, key)).status).toBe('building');
    expect(await historyOf(page, key)).toEqual(before);

    expect((await page.request.post(`/api/tickets/${key}/submit`)).status()).toBe(200);
    await page.reload();
    await expect(said(page)).toHaveCount(0);
    await page.getByTestId('open-terminal').click();
    await expect(said(page)).toContainText(NONE);
    expect((await read(page, key)).status).toBe('review');
  });

  test('the key and the palette reach it on a Ticket view, and a Ticket not in flight is told why by the key', async ({ page }) => {
    const { key } = await started(page, `By key ${n}`);
    await page.goto(`/tickets/${key}`);
    await expect(page.getByTestId('open-terminal')).toBeVisible();
    await page.keyboard.press('t');
    await expect(said(page)).toContainText(NONE);
    await page.keyboard.press('Escape');
    await expect(said(page)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'command palette' }).fill('open terminal');
    await expect(page.getByTestId('run-act-terminal')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(said(page)).toContainText(NONE);

    const waiting = await ready(page, `Too soon ${n}`);
    await page.goto(`/tickets/${waiting}`);
    await expect(page.getByTestId('move-start')).toBeVisible();
    await page.keyboard.press('t');
    await expect(page.getByTestId('state-tile').getByRole('alert')).toHaveText(`nothing opened — ${waiting} is ready, and only a building or review Ticket opens a terminal`);
    await expect(said(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'command palette' }).fill('open terminal');
    await expect(page.getByTestId('run-act-terminal')).toHaveCount(0);
  });

  test('a Ticket with no Worktree gets the modal without the Transition, and one history event', async ({ page }) => {
    const title = `No place ${n}`;
    const key = await plainlyStarted(page, title);
    const branch = `${key.toLowerCase()}-no-place-${n}`;
    await page.goto(`/tickets/${key}`);
    const before = await historyOf(page, key);
    await page.getByTestId('open-terminal').click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByRole('heading')).toContainText(`open terminal ${key}`);
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await expect(modal(page).getByLabel('branch')).toHaveValue(branch);
    await expect(modal(page).getByLabel('base')).toHaveValue('main');
    await expect(modal(page).getByTestId('start-go')).toContainText('open terminal');

    // cancelling changes nothing, and the focus comes back
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('open-terminal')).toBeFocused();
    expect((await read(page, key)).worktree_branch).toBeNull();

    await page.keyboard.press('Enter');
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);

    const folder = join(worktrees, 'subway-reader', branch);
    await expect(said(page).getByTestId('terminal-folder')).toHaveText(folder);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: branch, worktree_folder: folder });
    expect(git(folder, 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
    expect(await historyOf(page, key)).toHaveLength(before.length + 1);
    await expect(page.getByTestId('history').locator('li').first()).toContainText(`worktree ${branch}`);
    await expect(page.getByTestId('implementation-tile').getByTestId('worktree-folder')).toHaveText(folder);
  });

  test('with no Checkout there is nothing to make, so the modal offers the App and no way past it', async ({ page }) => {
    const home = (await (await page.request.post('/api/apps', { data: { name: `Bare App ${n}` } })).json()) as { id: number };
    const key = await plainlyStarted(page, `Bare ${n}`, home.id);
    await page.goto(`/tickets/${key}`);
    await page.getByTestId('open-terminal').click();
    await expect(modal(page)).toContainText(`Bare App ${n} has no Checkout, so ${key} cannot be given a Worktree`);
    await expect(modal(page).getByTestId('start-plain')).toHaveCount(0);
    await expect(modal(page).getByTestId('start-app-link')).toBeVisible();
    await expect(modal(page).getByTestId('start-cancel')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    expect((await read(page, key)).status).toBe('building');
  });

  test('a folder that has gone is refused in the state tile with the reason', async ({ page }) => {
    const { key, folder } = await started(page, `Gone away ${n}`);
    rmSync(folder, { recursive: true, force: true });
    await page.goto(`/tickets/${key}`);
    await page.getByTestId('open-terminal').click();
    await expect(page.getByTestId('state-tile').getByRole('alert')).toContainText(`nothing opened — the Worktree folder of ${key} no longer exists: ${folder}; git worktree prune`);
    await expect(said(page)).toHaveCount(0);
  });

  test('on the board: the key, the palette and the card menu act on the card, and say so under it', async ({ page }) => {
    // its own App, so its one in-flight card is the first the Cursor lands on, with one waiting after it
    const home = (await (await page.request.post('/api/apps', { data: { name: `Board App ${n}`, checkout: repo } })).json()) as { id: number };
    const key = await ready(page, `On the board ${n}`, home.id);
    const res = await page.request.post(`/api/tickets/${key}/start`, { data: {} });
    const { worktree_folder: folder } = (await res.json()) as { worktree_folder: string };
    const waiting = await ready(page, `Board waits ${n}`, home.id);
    await page.goto(`/?app_id=${home.id}&status=building,ready`);
    const card = page.getByTestId(`card-${key}`);
    const under = card.locator('..');
    await expect(card).toBeVisible();

    // the card's menu has it only where a Ticket is in flight
    await page.getByTestId(`menu-${waiting}`).click();
    await expect(page.getByTestId(`menu-${waiting}-terminal`)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId(`menu-${key}`).click();
    await page.getByTestId(`menu-${key}-terminal`).click();
    await expect(under.getByTestId('terminal-said')).toContainText(NONE);
    await expect(under.getByTestId('terminal-folder')).toHaveText(folder);

    // the keys, on the card under the Cursor
    await page.keyboard.press('Escape');
    await expect(said(page)).toHaveCount(0);
    await page.keyboard.press('j');
    await page.keyboard.press('l');
    await expect(card).toHaveAttribute('aria-current', /.+/);
    await page.keyboard.press('t');
    await expect(under.getByTestId('terminal-said')).toContainText(NONE);
    await expect(said(page).getByRole('button', { name: 'copy folder of this terminal' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(said(page)).toHaveCount(0);
    await expect(card).toBeFocused();

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'command palette' }).fill('open terminal');
    await expect(page.getByTestId('run-act-terminal')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(under.getByTestId('terminal-said')).toContainText(NONE);
    expect((await read(page, key)).status).toBe('building');

    // a press anywhere else lets it go, as it does a move's notice
    await page.getByTestId('crumb').click();
    await expect(said(page)).toHaveCount(0);

    // a Selection outranks the Cursor, and a terminal is for one Ticket
    await page.keyboard.press('x');
    await page.keyboard.press('t');
    await expect(page.getByText('a terminal opens on one ticket — clear the selection first')).toBeVisible();
    await expect(said(page)).toHaveCount(0);
  });

  test('on the board: a Start from the modal says it under the card, in its new column', async ({ page }) => {
    const title = `Board start ${n}`;
    const key = await ready(page, title);
    await page.goto(`/?app_id=${appId}`);
    await page.getByTestId(`menu-${key}`).click();
    await page.getByTestId(`menu-${key}-start`).click();
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    const under = page.getByTestId('col-building').getByTestId(`card-${key}`).locator('..');
    await expect(under.getByTestId('terminal-said')).toContainText(NONE);
    await expect(under.getByTestId('terminal-folder')).toHaveText(join(worktrees, 'subway-reader', `${key.toLowerCase()}-board-start-${n}`));
    // the line moved with its card, and the focus it took after the modal went moved with it (GF-131)
    await expect(under.getByRole('button', { name: 'copy folder of this terminal' })).toBeFocused();
  });

  test('on the board: a Ticket with no Worktree gets the modal, and stays in its column', async ({ page }) => {
    const key = await plainlyStarted(page, `Board none ${n}`);
    await page.goto(`/?app_id=${appId}`);
    await page.getByTestId(`menu-${key}`).click();
    await page.getByTestId(`menu-${key}-terminal`).click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByRole('heading')).toContainText(`terminal ${key}`);
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    const under = page.getByTestId('col-building').getByTestId(`card-${key}`).locator('..');
    await expect(under.getByTestId('terminal-said')).toContainText(NONE);
    await expect(said(page).getByRole('button', { name: 'copy folder of this terminal' })).toBeFocused();
    expect((await read(page, key)).status).toBe('building');
  });

  // GF-132: a card's menu leaves the Cursor where it was (DESIGN.md Card menu), so the terminal's modal from a card that
  // is not the Cursor's leaves the focus where the Cursor's keys are, as the Start modal does (GF-131)
  test('on the board: Open terminal from a card the Cursor is not on leaves the focus with the Cursor, on every close', async ({ page }) => {
    const word = `Termcursal ${n}`;
    const res = await page.request.post('/api/tickets', { data: { title: `${word} cursor`, status: 'planning', simple: true } });
    const cursorKey = ((await res.json()) as { key: string }).key;
    const cursorCard = page.getByTestId(`card-${cursorKey}`);
    const key = await plainlyStarted(page, `${word} menu`);
    await page.goto('/?q=' + encodeURIComponent(word));
    await expect(cursorCard).toBeVisible();
    await page.keyboard.press('j');
    await expect(cursorCard).toHaveAttribute('aria-current', 'true');
    const withCursor = async (close: string) => {
      await expect(modal(page), close).toHaveCount(0);
      await expect(page.locator('body'), close).toBeFocused();
      await expect(cursorCard, close).toHaveAttribute('aria-current', 'true');
      await expect(cursorCard, close).toBeInViewport();
    };
    const opened = async () => {
      await page.getByTestId(`menu-${key}`).click();
      await page.getByTestId(`menu-${key}-terminal`).click();
      await expect(modal(page).getByLabel('branch')).toBeFocused();
    };

    await opened();
    await modal(page).getByTestId('start-cancel').click();
    await withCursor('cancel');
    await opened();
    await page.keyboard.press('Escape');
    await withCursor('esc');
    await opened();
    await page.mouse.click(8, page.viewportSize()!.height - 8);
    await withCursor('a press outside');
    // the Checkout itself is on `main`, so git refuses it, and the refusal stays until `esc`
    await opened();
    await modal(page).getByLabel('branch').fill('main');
    await page.keyboard.press('Enter');
    await expect(modal(page).getByRole('alert')).toBeVisible();
    // the typing opened the branch list, and the first `esc` shuts that
    await page.keyboard.press('Escape');
    await expect(modal(page).getByRole('listbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await withCursor('a refusal, then esc');
    expect((await read(page, key)).worktree_branch).toBeNull();

    // a Worktree made and a terminal not opened: the folder is the way forward, so its copy has the focus, and keeps it
    await opened();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    await expect(said(page).getByRole('button', { name: 'copy folder of this terminal' })).toBeFocused();
    await expect(cursorCard).toHaveAttribute('aria-current', 'true');
    // and once the line goes, the focus does not go to the card it was about
    await page.keyboard.press('Escape');
    await expect(said(page)).toHaveCount(0);
    await withCursor('the line let go');
    // the Cursor's `⏎` opens the Cursor's Ticket
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tickets/${cursorKey}$`));
  });

  // This server has the built `herdr`, so nothing starts a Ticket while it is chosen.
  test('the terminal step is edited where the prefix is, and can be switched to herdr and back', async ({ page }) => {
    await page.goto('/settings');
    const tile = page.getByTestId('settings-tile');
    const choose = async (from: string, to: string) => {
      await expect(tile.getByTestId('terminal-step')).toHaveText(from);
      await page.keyboard.press('e');
      const form = page.getByTestId('settings-form');
      const field = form.getByLabel('terminal step');
      await expect(field).toHaveValue(from);
      await field.selectOption(to);
      await form.getByRole('button', { name: /save/ }).click();
      await expect(form).toBeHidden();
      await expect(tile.getByTestId('terminal-step')).toHaveText(to);
    };
    await choose('none', 'herdr');
    await choose('herdr', 'none');
  });
});
