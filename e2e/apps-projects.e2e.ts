import { expect, test } from '@playwright/test';

/** Issue 02's exit criterion: create, see, rename, archive, trash and restore — through the forms. */
test('an app and a project through the GUI: create, rename, archive, trash, restore', async ({ page }) => {
  await page.goto('/apps');
  await expect(page.getByTestId('apps-tile')).toContainText('no apps yet');

  // the tile header's + opens the inline create form; ⌘⏎ saves
  await page.getByRole('button', { name: 'new app' }).click();
  const appForm = page.getByTestId('new-app-form');
  await appForm.getByLabel('name').fill('Subway Reader');
  await appForm.getByLabel('repository url').fill('https://github.com/itsRoze/subway-reader');
  await appForm.getByLabel('default branch').fill('main');
  await appForm.getByLabel('description').fill('An RSS reader for the subway');
  await appForm.getByLabel('description').press('ControlOrMeta+Enter');

  await expect(page).toHaveURL(/\/apps\/subway-reader-\d+$/);
  await expect(page.getByTestId('page-title')).toHaveText('Subway Reader');
  await expect(page.getByTestId('about-tile')).toContainText('https://github.com/itsRoze/subway-reader');
  await expect(page.getByTestId('history')).toContainText('created');

  // a project inside the app
  await page.getByRole('button', { name: 'new project' }).click();
  const projectForm = page.getByTestId('new-project-form');
  await projectForm.getByLabel('name').fill('MVP');
  await projectForm.getByLabel('description').fill('first cut');
  await projectForm.getByLabel('description').press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/projects\/mvp-\d+$/);
  await expect(page.getByTestId('crumb')).toHaveText('Subway Reader / MVP');

  // the all-projects list groups it under its app
  await page.goto('/projects');
  await expect(page.getByTestId('group-app-1')).toContainText('Subway Reader');
  await expect(page.getByTestId('group-app-1')).toContainText('MVP');

  // rename from the about tile; the stale slug in the URL redirects
  await page.getByRole('link', { name: 'MVP' }).click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  const projectUrl = page.url();
  // `e` belongs to the always-live description now (issue 07); the rest of the about tile edits from its button
  await page.getByRole('button', { name: 'edit project' }).click();
  await page.getByTestId('edit-form').getByLabel('name').fill('Subway Reader MVP');
  await page.getByTestId('edit-form').getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('page-title')).toContainText('Subway Reader MVP');
  await expect(page).toHaveURL(/\/projects\/subway-reader-mvp-\d+$/);
  await expect(page.getByTestId('history').locator('li').first()).toContainText('renamed MVP → Subway Reader MVP');
  await page.goto(projectUrl);
  await expect(page).toHaveURL(/\/projects\/subway-reader-mvp-\d+$/);

  // archive hides it from the list but it still opens
  await page.getByRole('button', { name: 'archive' }).click();
  await expect(page.getByTestId('about-tile')).toContainText('archived');
  await page.goto('/projects');
  await expect(page.getByTestId('projects-tile')).toContainText('no projects yet');
  await page.getByLabel('show archived').check();
  await expect(page.getByTestId('group-app-1')).toContainText('Subway Reader MVP');

  // trash the app, find it in /trash, restore it with r
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Subway Reader' }).click();
  await expect(page.getByTestId('about-tile')).toBeVisible();
  await page.getByRole('button', { name: 'trash' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByTestId('apps-tile')).toContainText('no apps yet');
  await page.goto('/trash');
  await expect(page.getByTestId('trash-app-1')).toContainText('Subway Reader');
  await expect(page.getByTestId('trash-apps-tile')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByTestId('trash-apps-tile')).toContainText('no apps in the trash');
  await page.goto('/apps');
  await expect(page.getByRole('link', { name: 'Subway Reader' })).toBeVisible();
  // the project was detached, not trashed, and is not re-attached by the restore
  await page.goto('/projects');
  await page.getByLabel('show archived').check();
  await expect(page.getByTestId('group-none')).toContainText('Subway Reader MVP');
});
