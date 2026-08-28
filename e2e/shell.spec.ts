import { expect, test } from '@playwright/test';

test('the shell loads and shows the ticket prefix from settings', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Goblin Foundry');
  await expect(page.getByTestId('ticket-prefix')).toHaveText('GF');
});
