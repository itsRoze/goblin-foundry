import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GF-121: one `ready` Ticket is started through the modal, against a temporary
 * Checkout. Named to run after the desktop specs, whose app lists these Apps
 * would crowd.
 */
test.describe('the Start modal', () => {
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
  const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; worktree_branch: string | null; worktree_folder: string | null };
  const modal = (page: Page) => page.getByTestId('start-modal');
  const slugged = (key: string, title: string) => `${key.toLowerCase()}-${title.toLowerCase().replaceAll(' ', '-')}`;

  const openOnTicket = async (page: Page, key: string) => {
    await page.goto(`/tickets/${key}`);
    await page.getByTestId('move-start').click();
    await expect(modal(page)).toBeVisible();
  };

  test.beforeAll(async ({ request }) => {
    // real, because git answers with where a folder actually is and macOS's temp dir is a symlink
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-start-')));
    repo = join(root, 'subway-reader');
    worktrees = join(root, 'worktrees');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(repo, 'branch', 'existing-work');
    git(repo, 'branch', 'stack-on-me');
    git(repo, 'branch', 'second-existing');
    const home = await request.post('/api/apps', { data: { name: 'Start Modal App', checkout: repo } });
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

  test('the defaults start a Ticket into a new Worktree on Enter alone', async ({ page }) => {
    const title = `Parse feed ${n}`;
    const key = await ready(page, title);
    await openOnTicket(page, key);
    const branch = slugged(key, title);
    const folder = join(worktrees, 'subway-reader', branch);

    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await expect(modal(page).getByLabel('branch')).toHaveValue(branch);
    await expect(modal(page).getByTestId('start-line')).toHaveText('new branch: it will be created');
    await expect(modal(page).getByLabel('base')).toHaveValue('main');
    await expect(modal(page).getByTestId('start-folder')).toHaveText(folder);

    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('implementation-tile').getByTestId('worktree-folder')).toHaveText(folder);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: branch, worktree_folder: folder });
    expect(git(folder, 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
  });

  test('an existing branch hides the base; a new one shows it, and offers any branch to cut from', async ({ page }) => {
    const key = await ready(page, `Existing or new ${n}`);
    await openOnTicket(page, key);
    const field = modal(page).getByLabel('branch');
    const base = modal(page).getByLabel('base');
    await expect(base).toBeVisible();

    // typing filters the Checkout's branches, and the modal says which it is before anything happens
    await field.fill('existing');
    await expect(modal(page).getByRole('option')).toHaveText(['existing-work', 'second-existing']);
    await expect(modal(page).getByTestId('start-line')).toHaveText('new branch: it will be created');
    await field.fill('existing-work');
    await expect(modal(page).getByTestId('start-line')).toHaveText('existing branch');
    await expect(base).toHaveCount(0);
    await expect(modal(page).getByTestId('start-folder')).toHaveText(join(worktrees, 'subway-reader', 'existing-work'));

    // a name nobody has brings the base back, with the keys alone choosing what it is cut from
    await field.fill('cut-from-stack');
    await expect(modal(page).getByTestId('start-line')).toHaveText('new branch: it will be created');
    await expect(base).toHaveValue('main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    await page.keyboard.press('Tab');
    await expect(base).toBeFocused();
    await page.keyboard.type('stack');
    await expect(base).toHaveValue('stack');
    await expect(modal(page).getByRole('option')).toHaveText(['stack-on-me']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(base).toHaveValue('stack-on-me');
    await expect(modal(page)).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    const folder = join(worktrees, 'subway-reader', 'cut-from-stack');
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: 'cut-from-stack', worktree_folder: folder });
    // cut from the base asked for, which is behind main by the commit made above
    expect(git(folder, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'stack-on-me'));
    expect(git(folder, 'rev-parse', 'HEAD')).not.toBe(git(repo, 'rev-parse', 'main'));
  });

  test('starting on an existing branch checks it out', async ({ page }) => {
    git(repo, 'branch', `picked-${n}`);
    const key = await ready(page, `Pick existing ${n}`);
    await openOnTicket(page, key);
    await modal(page).getByLabel('branch').fill(`picked-${n}`);
    await expect(modal(page).getByRole('option')).toHaveText([`picked-${n}`]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(modal(page).getByTestId('start-line')).toHaveText('existing branch');
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: `picked-${n}` });
  });

  test('a branch already in a Worktree says so, and shows that folder', async ({ page }) => {
    const elsewhere = join(root, `elsewhere-${n}`);
    git(repo, 'worktree', 'add', '-q', '-b', `in-a-worktree-${n}`, elsewhere);
    const key = await ready(page, `Adopt it ${n}`);
    await openOnTicket(page, key);
    await modal(page).getByLabel('branch').fill(`in-a-worktree-${n}`);
    await expect(modal(page).getByTestId('start-line')).toHaveText('existing branch, already in a Worktree: that one is used');
    await expect(modal(page).getByLabel('base')).toHaveCount(0);
    await expect(modal(page).getByTestId('start-folder')).toHaveText(elsewhere);
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_folder: elsewhere });
  });

  test('a stopped Ticket is offered its Worktree again', async ({ page }) => {
    const key = await ready(page, `Stop and resume ${n}`);
    expect((await page.request.post(`/api/tickets/${key}/start`, { data: { branch: `resume-${n}` } })).status()).toBe(200);
    expect((await page.request.post(`/api/tickets/${key}/stop`)).status()).toBe(200);
    await openOnTicket(page, key);
    await expect(modal(page).getByLabel('branch')).toHaveValue(`resume-${n}`);
    await expect(modal(page).getByTestId('start-folder')).toHaveText(join(worktrees, 'subway-reader', `resume-${n}`));
  });

  test('a refused Start says why in the modal, leaves it open, and the Ticket where it was', async ({ page }) => {
    const key = await ready(page, `Refused ${n}`);
    await openOnTicket(page, key);
    // the Checkout itself is on `main`, so git refuses a second place for it
    await modal(page).getByLabel('branch').fill('main');
    await expect(modal(page).getByTestId('start-line')).toHaveText('checked out in the Checkout itself: git will refuse it');
    await page.keyboard.press('Enter');
    const refusal = modal(page).getByRole('alert');
    await expect(refusal).toContainText(`nothing changed — no Worktree for ${key}:`);
    await expect(modal(page)).toBeVisible();
    expect((await read(page, key)).status).toBe('ready');
    // it stays to be read, past the four seconds and the click that clear a refusal elsewhere
    await modal(page).getByLabel('branch').click();
    await expect(refusal).toBeVisible();

    await modal(page).getByLabel('branch').fill(`after-refusal-${n}`);
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: `after-refusal-${n}` });
  });

  test('Escape and cancel change nothing, and the focus comes back', async ({ page }) => {
    const key = await ready(page, `Just looking ${n}`);
    await openOnTicket(page, key);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('move-start')).toBeFocused();
    expect(await read(page, key)).toMatchObject({ status: 'ready', worktree_branch: null });
    expect(page.url()).toContain(`/tickets/${key}`);

    await page.getByTestId('move-start').click();
    await modal(page).getByTestId('start-cancel').click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('move-start')).toBeFocused();
    expect((await read(page, key)).status).toBe('ready');
    expect(existsSync(join(worktrees, 'subway-reader', slugged(key, `Just looking ${n}`)))).toBe(false);
  });

  test('the first Escape shuts an open list, not the modal', async ({ page }) => {
    const key = await ready(page, `List first ${n}`);
    await openOnTicket(page, key);
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(modal(page).getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page).getByRole('listbox')).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
  });

  test('the board and the keys reach it through the modal, and its keys stay inside it', async ({ page }) => {
    const title = `Keyed start ${n}`;
    const key = await ready(page, title);
    await page.goto('/?q=' + encodeURIComponent(title));
    await expect(page.getByTestId(`card-${key}`)).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.getByTestId(`card-${key}`)).toHaveAttribute('aria-current', 'true');

    // `s`, then the first row, as a human's held ⏎ would press it: one press acts, its repeats do nothing
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await page.keyboard.down('Enter');
    await expect(modal(page)).toBeVisible();
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(modal(page)).toBeVisible();
    expect((await read(page, key)).status).toBe('ready');

    // the board's `c` and `j` are not reachable from inside, from a button as much as a field
    await modal(page).getByTestId('start-go').focus();
    await page.keyboard.press('c');
    await expect(page.getByTestId('board-create')).toHaveCount(0);
    // and Tab stays in the modal
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="start-modal"]') !== null)).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    expect((await read(page, key)).status).toBe('ready');

    // ⌘K reaches the same modal
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByTestId('run-move-start').click();
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('col-building')).toContainText(title);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: slugged(key, title) });
  });

  test('dragging a card from ready to building opens the same modal, and cancelling leaves the card', async ({ page }) => {
    const title = `Dragged start ${n}`;
    const key = await ready(page, title);
    await page.goto('/?q=' + encodeURIComponent(title));
    const card = page.getByTestId(`card-${key}`);
    await expect(page.getByTestId('col-ready')).toContainText(title);

    await card.dragTo(page.getByTestId('col-building'));
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).getByLabel('branch')).toHaveValue(slugged(key, title));
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('col-ready')).toContainText(title);
    expect((await read(page, key)).status).toBe('ready');

    await card.dragTo(page.getByTestId('col-building'));
    await expect(modal(page).getByLabel('branch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId('col-building')).toContainText(title);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: slugged(key, title) });
  });

  test('the question about a Blocked Ticket comes first', async ({ page }) => {
    const blocker = await ready(page, `The blocker ${n}`);
    const key = await ready(page, `The blocked ${n}`);
    expect((await page.request.post(`/api/tickets/${key}/dependencies`, { data: { blocker } })).ok()).toBe(true);
    await page.goto(`/tickets/${key}`);
    await page.getByTestId('move-start').click();
    await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
    await expect(modal(page)).toHaveCount(0);
    await page.getByTestId('confirm-start-yes').click();
    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect((await read(page, key)).status).toBe('ready');
    // the button that answered the question is gone, so the focus goes to what asked it
    await expect(page.getByTestId('move-start')).toBeFocused();
  });

  test('a bulk start on a Selection stays a plain Transition', async ({ page }) => {
    const [one, two] = [await ready(page, `Bulk start one ${n}`), await ready(page, `Bulk start two ${n}`)];
    await page.goto('/?q=' + encodeURIComponent(`Bulk start`));
    await page.getByTestId(`select-${one}`).check();
    await page.getByTestId(`select-${two}`).check();
    await page.getByTestId('bulk-status').click();
    await page.getByTestId('run-move-start').click();
    await expect(page.getByTestId('col-building')).toContainText(`Bulk start one ${n}`);
    await expect(modal(page)).toHaveCount(0);
    expect(await read(page, one)).toMatchObject({ status: 'building', worktree_branch: null, worktree_folder: null });
    expect(await read(page, two)).toMatchObject({ status: 'building', worktree_branch: null, worktree_folder: null });
  });

  test('with no Checkout it says so, and offers the App view and a start without a Worktree', async ({ page }) => {
    const home = await page.request.post('/api/apps', { data: { name: `Homeless App ${n}` } });
    const app = (await home.json()) as { id: number };
    const key = await ready(page, `No home ${n}`, app.id);
    await openOnTicket(page, key);
    await expect(modal(page)).toContainText(`Homeless App ${n} has no Checkout, so ${key} cannot be given a Worktree`);
    await expect(modal(page).getByLabel('branch')).toHaveCount(0);

    await modal(page).getByTestId('start-app-link').click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/apps/homeless-app-${n}-${app.id}$`));
    expect((await read(page, key)).status).toBe('ready');

    await openOnTicket(page, key);
    // the safe answer has the focus: `⏎` on a sentence not yet read writes nothing
    await expect(modal(page).getByTestId('start-cancel')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    expect((await read(page, key)).status).toBe('ready');

    await openOnTicket(page, key);
    await expect(modal(page).getByTestId('start-cancel')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(modal(page).getByTestId('start-plain')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: null, worktree_folder: null });
  });

  test('a Checkout with no commit yet says so, rather than forecasting a branch git cannot cut', async ({ page }) => {
    const empty = join(root, `fresh-${n}`);
    mkdirSync(empty);
    git(empty, 'init', '-q', '-b', 'main');
    const home = await page.request.post('/api/apps', { data: { name: `Fresh App ${n}`, checkout: empty } });
    const key = await ready(page, `Fresh start ${n}`, ((await home.json()) as { id: number }).id);
    await openOnTicket(page, key);
    await expect(modal(page)).toContainText(`the Checkout ${empty} has no commit yet, so ${key} cannot be given a Worktree`);
    await expect(modal(page).getByLabel('branch')).toHaveCount(0);
    await expect(modal(page).getByTestId('start-cancel')).toBeFocused();
    await modal(page).getByTestId('start-plain').click();
    await expect(modal(page)).toHaveCount(0);
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_branch: null, worktree_folder: null });
  });

  test('a Checkout with no branch offers no list, and still starts from where it is', async ({ page }) => {
    const bare = join(root, `branchless-${n}`);
    mkdirSync(bare);
    git(bare, 'init', '-q', '-b', 'main');
    git(bare, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(bare, 'switch', '-q', '--detach');
    git(bare, 'branch', '-q', '-D', 'main');
    const home = await page.request.post('/api/apps', { data: { name: `Branchless App ${n}`, checkout: bare } });
    const title = `No branches ${n}`;
    const key = await ready(page, title, ((await home.json()) as { id: number }).id);
    await openOnTicket(page, key);
    await expect(modal(page).getByTestId('start-line')).toHaveText('new branch: it will be created');
    await expect(modal(page).getByTestId('start-go')).toBeVisible();
    // a hint for a list with no rows would be a promise the keys cannot keep (Voice)
    await expect(modal(page).locator('.gf-start-hint')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(modal(page).getByRole('listbox')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(modal(page)).toHaveCount(0);
    const folder = join(worktrees, `branchless-${n}`, slugged(key, title));
    expect(await read(page, key)).toMatchObject({ status: 'building', worktree_folder: folder });
    expect(git(folder, 'rev-parse', 'HEAD')).toBe(git(bare, 'rev-parse', 'HEAD'));
  });

  test('a Ticket with no App, or a Checkout gone from the machine, still has a way through', async ({ page }) => {
    // trashing its App is the one way a `ready` Ticket comes to have none, since the guard wants one on the way in
    const left = (await (await page.request.post('/api/apps', { data: { name: `Trashed App ${n}` } })).json()) as { id: number };
    const orphan = await ready(page, `Orphan ${n}`, left.id);
    expect((await page.request.delete(`/api/apps/${left.id}`)).ok()).toBe(true);
    expect(((await (await page.request.get(`/api/tickets/${orphan}`)).json()) as { app_id: number | null }).app_id).toBeNull();
    await openOnTicket(page, orphan);
    await expect(modal(page)).toContainText(`${orphan} has no App, so it has no Checkout to make a Worktree of`);
    await expect(modal(page).getByTestId('start-app-link')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const gone = join(root, 'soon-gone');
    mkdirSync(gone);
    git(gone, 'init', '-q');
    const home = await page.request.post('/api/apps', { data: { name: `Moved App ${n}`, checkout: gone } });
    const key = await ready(page, `Moved checkout ${n}`, ((await home.json()) as { id: number }).id);
    rmSync(gone, { recursive: true, force: true });
    await openOnTicket(page, key);
    await expect(modal(page)).toContainText(`the Checkout ${gone} is not there`);
    await modal(page).getByTestId('start-plain').click();
    await expect(modal(page)).toHaveCount(0);
    expect((await read(page, key)).status).toBe('building');
  });
});
