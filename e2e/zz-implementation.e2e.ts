import { expect, test } from '@playwright/test';

test('copy the current branch suggestion; save and remove multiple implementation URLs', async ({ page, context }) => {
  const response = await page.request.post('/api/tickets', { data: { title: 'Choose a useful finite-edition selection policy', status: 'planning' } });
  const ticket = await response.json() as { key: string };
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/tickets/${ticket.key}`);
  const panel = page.getByTestId('implementation-tile');
  await panel.getByRole('button', { name: 'copy git branch name' }).click();
  await expect(panel.getByRole('button', { name: 'copy git branch name' })).toHaveText('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ticket.key.toLowerCase()}-choose-a-useful-finite-edition-selection-policy`);
  await page.request.patch(`/api/tickets/${ticket.key}`, { data: { title: 'Updated reading plan' } });
  await page.reload();
  await panel.getByRole('button', { name: 'copy git branch name' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ticket.key.toLowerCase()}-updated-reading-plan`);

  const urls = ['https://github.com/example/reader/pull/14', `https://github.com/example/reader/commit/abc123?view=${'x'.repeat(600)}`];
  for (const url of urls) {
    await panel.getByLabel('PR or commit URL').fill(url);
    await panel.getByRole('button', { name: 'add link', exact: true }).click();
    await expect(panel.getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
  }
  await page.reload();
  await expect(panel.getByRole('link')).toHaveCount(2);
  await panel.getByLabel('PR or commit URL').fill(urls[0]!);
  await panel.getByRole('button', { name: 'add link', exact: true }).click();
  await expect(panel.getByLabel('PR or commit URL')).toHaveValue('');
  await expect(panel.getByRole('link')).toHaveCount(2);
  await panel.getByRole('button', { name: `remove ${urls[0]}`, exact: true }).click();
  await expect(panel.getByRole('link')).toHaveCount(1);
  await expect(page.getByTestId('history')).toContainText('removed implementation link');
  expect((await (await page.request.get(`/api/tickets/${ticket.key}`)).json()).status).toBe('planning');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('a refused link stays editable, and clipboard failure never claims it copied', async ({ page }) => {
  const ticket = await (await page.request.post('/api/tickets', { data: { title: 'Copy refusal' } })).json() as { key: string };
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }));
  await page.goto(`/tickets/${ticket.key}`);
  const panel = page.getByTestId('implementation-tile');
  await panel.getByRole('button', { name: 'copy git branch name' }).click();
  await expect(panel.getByRole('alert')).toContainText('copy it manually');
  await expect(panel.getByRole('button', { name: 'copy git branch name' })).toHaveText('copy branch');
  await panel.getByLabel('PR or commit URL').fill('ftp://example.com/commit/abc');
  await panel.getByRole('button', { name: 'add link', exact: true }).click();
  await expect(panel).toContainText('use an http or https URL');
  await expect(panel.getByLabel('PR or commit URL')).toHaveValue('ftp://example.com/commit/abc');
  await expect(panel.getByRole('link')).toHaveCount(0);
});

test('the ticket palette copies its branch and focuses the existing link form', async ({ page, context }) => {
  const ticket = await (await page.request.post('/api/tickets', { data: { title: 'Palette branch and links', status: 'planning' } })).json() as { key: string };
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/tickets/${ticket.key}`);
  await expect(page.getByTestId('implementation-tile')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'command palette' }).fill('copy branch');
  await page.getByRole('combobox', { name: 'command palette' }).press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('implementation-tile')).toContainText('branch name copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ticket.key.toLowerCase()}-palette-branch-and-links`);

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'command palette' }).fill('add link');
  await page.getByRole('combobox', { name: 'command palette' }).press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  const input = page.getByLabel('PR or commit URL');
  await expect(input).toBeFocused();
  const url = 'https://github.com/example/reader/pull/27';
  await input.fill(url);
  await input.press('Enter');
  await expect(page.getByTestId('implementation-tile').getByRole('link', { name: url })).toBeVisible();
});

test('board palette targets the cursor ticket and does not offer single-ticket commands for a selection', async ({ page, context }) => {
  const ticket = await (await page.request.post('/api/tickets', { data: { title: 'Cursor implementation command', status: 'planning' } })).json() as { key: string };
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?q=Cursor%20implementation%20command');
  const card = page.getByTestId(`card-${ticket.key}`);
  await expect(card).toBeVisible();
  await page.keyboard.press('j');
  await expect(card).toHaveClass(/is-cursor/);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'command palette' }).fill('copy branch');
  await expect(page.getByTestId('run-act-copy-branch')).toBeVisible();
  await page.getByRole('combobox', { name: 'command palette' }).press('Enter');
  await expect(page.getByTestId('board-tile')).toContainText(`${ticket.key} branch name copied`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ticket.key.toLowerCase()}-cursor-implementation-command`);

  await page.keyboard.press('x');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'command palette' }).fill('copy branch');
  await expect(page.getByTestId('run-act-copy-branch')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'command palette' }).fill('add link');
  await expect(page.getByTestId('run-act-add-implementation-link')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'command palette' }).fill('add PR');
  await page.getByRole('combobox', { name: 'command palette' }).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.key}$`));
  await expect(page.getByLabel('PR or commit URL')).toBeFocused();
  await page.goto('/settings');
  await expect(page.getByTestId('ticket-prefix')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'command palette' }).fill('copy branch');
  await expect(page.getByTestId('run-act-copy-branch')).toHaveCount(0);
});
