import { expect, test, type Page } from '@playwright/test';

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
