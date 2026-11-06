import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    addressWrites: string[];
  }
}

/**
 * Issue 06's exit criterion: the Filter lives in the address, so a bookmarked
 * URL is a saved view and reload, back and forward all land on the same board.
 */

/** An app with a project in it, made through the forms the rest of the suite uses. */
async function scope(page: Page, app: string, project: string) {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  const appForm = page.getByTestId('new-app-form');
  await appForm.getByLabel('name').fill(app);
  await appForm.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('page-title')).toHaveText(app);

  await page.getByRole('button', { name: 'new project' }).click();
  const projectForm = page.getByTestId('new-project-form');
  await projectForm.getByLabel('name').fill(project);
  await projectForm.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('crumb')).toHaveText(`${app} / ${project}`);
}

/** One ticket from the board's create row, left wherever the row's fields say. */
async function create(page: Page, title: string) {
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  const row = page.getByTestId('board-create');
  await row.getByLabel('ticket title').fill(title);
  await row.getByLabel('ticket title').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('board')).toContainText(title);
}

test('the filter is the address: chips, reload, back, and a create in the filtered scope', async ({ page }) => {
  await scope(page, 'Filtered Reader', 'Pagination');

  // the tickets tile's `board` link is the same Filter a chip would set
  await page.getByTestId('tickets-tile').getByRole('link', { name: 'board' }).click();
  await expect(page).toHaveURL(/\/\?project_id=\d+$/);
  const projectUrl = page.url();

  // `c` on a project-filtered board prefills the project, so the ticket lands on this board
  await create(page, 'Paginate the article list');
  await expect(page.getByTestId('col-backlog')).toContainText('Paginate the article list');
  // the ticket's meta line says where it went
  await expect(page.locator('[data-testid^="card-"]', { hasText: 'Paginate the article list' })).toContainText('Filtered Reader / Pagination');

  // a ticket outside the filter is not on this board
  await page.goto('/');
  await create(page, 'Something else entirely');
  await page.goto(projectUrl);
  await expect(page.getByTestId('board')).not.toContainText('Something else entirely');

  // the chip says what the address does; the status chip narrows the columns
  await expect(page.getByTestId('chip-project')).toContainText('Pagination');

  // a second press on an open chip shuts it, rather than closing and reopening under the same click
  await page.getByTestId('chip-status').click();
  await expect(page.getByTestId('pop-status')).toBeVisible();
  await page.getByTestId('chip-status').click();
  await expect(page.getByTestId('pop-status')).toHaveCount(0);

  await page.getByTestId('chip-status').click();
  // the box is answered by the address, so the click and the assertion are separate (docs/LESSONS.md)
  await page.getByTestId('check-backlog').click();
  await expect(page.getByTestId('col-backlog')).toHaveCount(0);
  await expect(page.getByTestId('col-todo')).toBeVisible();
  await page.keyboard.press('Escape');
  const bookmarked = page.url();
  expect(bookmarked).toMatch(/project_id=\d+&status=todo,planning,ready,building,review,done/);

  // a reload lands on the same board, and the address is not rewritten on the way
  await page.reload();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(page.url()).toBe(bookmarked);
  await expect(page.getByTestId('col-backlog')).toHaveCount(0);
  await expect(page.getByTestId('chip-project')).toContainText('Pagination');
  await expect(page.getByTestId('chip-status')).toContainText('6');

  // open a ticket and come back: the filter is where you left it, because it was replaced, never pushed
  await page.goto(projectUrl);
  await page.locator('[data-testid^="card-"]', { hasText: 'Paginate the article list' }).click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(page.url()).toBe(projectUrl);

  // picking a project in the picker fills its app, and taking the app away drops a project outside it (ADR-0007)
  await page.goto('/');
  await page.getByTestId('chip-project').click();
  await page.getByTestId('pop-project').getByRole('option', { name: 'Pagination' }).click();
  await expect(page).toHaveURL(/\/\?app_id=\d+&project_id=\d+$/);
  await expect(page.getByTestId('chip-app')).toContainText('Filtered Reader');
  await page.getByTestId('chip-app').click();
  await page.getByTestId('pick-app-any').click();
  await expect(page).toHaveURL(/\/$/);

  // `f` finds by text, after 200 ms of quiet; `×` clears everything at once
  await page.goto('/');
  await page.keyboard.press('f');
  await page.getByLabel('filter by text').fill('entirely');
  await expect(page).toHaveURL(/\/\?q=entirely$/);
  await expect(page.getByTestId('board')).toContainText('Something else entirely');
  await expect(page.getByTestId('board')).not.toContainText('Paginate the article list');
  await page.getByLabel('clear filters').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('board')).toContainText('Paginate the article list');
});

/**
 * React runs a component's effects in a later task when the commit that drew it used up its
 * time slice, so on a slow machine a keystroke can land between the two. The init script makes
 * that order certain: it spends React's slice the instant the box is in the DOM, so React
 * yields, and types in the microtask that follows the commit.
 */
test('text typed the instant the filter appears is kept and reaches the address', async ({ page }) => {
  await page.addInitScript(() => {
    const box = () => document.querySelector<HTMLInputElement>('input[aria-label="filter by text"]');
    const now = performance.now.bind(performance);
    let drawn = false;
    performance.now = () => {
      drawn ||= box() !== null;
      return now() + (drawn ? 50 : 0);
    };
    new MutationObserver((_, observer) => {
      const input = box();
      if (!input) return;
      observer.disconnect();
      input.focus();
      document.execCommand('insertText', false, 'entirely');
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await expect(page.getByLabel('filter by text')).toHaveValue('entirely');
  await expect(page).toHaveURL(/\/\?q=entirely$/);
});

test('the text box follows the address when something else changes it', async ({ page }) => {
  await page.goto('/');
  const box = page.getByLabel('filter by text');
  await box.fill('entirely');
  await expect(page).toHaveURL(/\/\?q=entirely$/);

  await page.getByLabel('clear filters').click();
  await expect(box).toHaveValue('');
});

// the router draws a written address inside `startTransition`, so a letter typed between the write and that draw is the GF-99 case
test('a letter typed while the address catches up is kept, and the address follows it', async ({ page }) => {
  await page.addInitScript(() => {
    const replace = history.replaceState.bind(history);
    let typed = false;
    history.replaceState = (data, unused, url) => {
      replace(data, unused, url);
      if (typed || !String(url).includes('q=entirel')) return;
      typed = true;
      document.execCommand('insertText', false, 'y');
    };
  });
  await page.goto('/');
  const box = page.getByLabel('filter by text');
  await box.pressSequentially('entirel');
  await expect(box).toHaveValue('entirely');
  await expect(page).toHaveURL(/\/\?q=entirely$/);
});

test('a trailing space stays in the box and writes the address once', async ({ page }) => {
  await page.addInitScript(() => {
    const replace = history.replaceState.bind(history);
    window.addressWrites = [];
    history.replaceState = (data, unused, url) => {
      // the router's own first call carries no address
      if (url != null) window.addressWrites.push(String(url));
      replace(data, unused, url);
    };
  });
  await page.goto('/');
  const box = page.getByLabel('filter by text');
  await box.fill('entirely');
  await expect(page).toHaveURL(/\/\?q=entirely$/);
  await box.press('Space');
  await page.waitForTimeout(1000);
  await expect(box).toHaveValue('entirely ');
  expect(await page.evaluate(() => window.addressWrites)).toEqual(['/?q=entirely']);
});

test('back after typing a filter leaves the board, and forward brings the filter back', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('navigation', { name: 'workspaces' }).getByRole('link', { name: 'board' }).click();
  await expect(page.getByTestId('board')).toBeVisible();
  const box = page.getByLabel('filter by text');
  await box.pressSequentially('entirely');
  await expect(page).toHaveURL(/\/\?q=entirely$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/apps$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/\?q=entirely$/);
  await expect(page.getByLabel('filter by text')).toHaveValue('entirely');
});

test('a value the API refuses is shown, not corrected', async ({ page }) => {
  await page.goto('/?app_id=null&status=shipped');
  await expect(page.getByTestId('filter-refusal')).toContainText('shipped is not a status');
  // the parameter that parsed keeps its chip; the one that did not shows what was pasted, so the refusal points somewhere
  await expect(page.getByTestId('chip-app')).toContainText('none');
  await expect(page.getByTestId('chip-status')).toContainText('shipped');
  // the address is left exactly as it was pasted: a bookmark is not silently rewritten
  await expect(page).toHaveURL(/\/\?app_id=null&status=shipped$/);
  await expect(page.getByTestId('board')).not.toContainText('Paginate');
});

test('show archived is part of the address: it survives a reload and clearing it takes it out (ADR-0015)', async ({ page }) => {
  await page.goto('/?q=nothing-matches');
  const toggle = page.getByTestId('filter-archived');
  await expect(toggle).not.toBeChecked();
  // a click, not `check()`: the box is the address's, so it turns once the address has
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page).toHaveURL(/[?&]q=nothing-matches&archived=1$/);
  await page.reload();
  await expect(page.getByTestId('filter-archived')).toBeChecked();
  await page.getByTestId('filter-archived').click();
  await expect(page.getByTestId('filter-archived')).not.toBeChecked();
  await expect(page).toHaveURL(/\/\?q=nothing-matches$/);
});
