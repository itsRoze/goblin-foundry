import { expect, test } from '@playwright/test';

test('the shell loads with the kanban as home and the prefix on the settings page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Goblin Foundry');
  await expect(page.getByTestId('col-backlog')).toBeVisible();

  await page.getByRole('link', { name: 'settings' }).click();
  await expect(page.getByTestId('ticket-prefix')).toHaveText('GF');
});
