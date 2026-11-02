import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * GF-44: the state tile's question and refusal open where the hand can see
 * and answer them, and the focus comes back to the control that asked.
 * Named to run late: the earlier specs count tickets and address keys by name.
 */

/** A phone-tall window, where the state tile sits below the fold (the ticket's own measurement). */
const NARROW = { width: 500, height: 723 };

type Ticket = { key: string };

const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;

/** A `ready` Ticket with one open blocker, so `start` asks first. */
async function blockedTicket(page: Page, name: string, fields: object = {}) {
  const app = await post<{ id: number }>(page, '/api/apps', { name: `${name} app` });
  const blocker = await post<Ticket>(page, '/api/tickets', { title: `${name} blocker` });
  const blocked = await post<Ticket>(page, '/api/tickets', { title: `${name} blocked`, status: 'ready', app_id: app.id, simple: true, ...fields });
  await page.request.post(`/api/tickets/${blocked.key}/dependencies`, { data: { blocker: blocker.key } });
  await page.goto(`/tickets/${blocked.key}`);
  await expect(page.getByTestId('state-tile')).toBeVisible();
  return blocked;
}

async function askByKey(page: Page) {
  await page.keyboard.press('s');
  await expect(page.getByTestId('run-move-start')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
}

test('s ⏎ on a blocked Ticket puts `start anyway` on screen and under the focus, so ⏎ answers it (GF-44, GF-84)', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await blockedTicket(page, 'Askfocus');
  await askByKey(page);
  await expect(page.getByTestId('confirm-start-yes')).toBeFocused();
  await expect(page.getByTestId('confirm-start-yes')).toBeInViewport();
  await expect(page.getByTestId('state-tile')).toHaveClass(/is-focus/);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('state-tile')).toContainText('building');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
});

test('esc and cancel hand the focus back to `start`, and ⏎ there asks again rather than opening something else', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await blockedTicket(page, 'Askback');
  await askByKey(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await page.getByTestId('confirm-start').getByRole('button', { name: 'cancel' }).click();
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();
});

test('a refused key brings the refusal on screen', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await blockedTicket(page, 'Refuse', { status: 'building' });
  await page.keyboard.press('a');
  await expect(page.getByTestId('state-refusal')).toHaveText('a ticket in building does not go back to ready');
  await expect(page.getByTestId('state-refusal')).toBeInViewport();
  await expect(page.getByTestId('state-tile')).toHaveClass(/is-focus/);
});

test('esc in the dependency picker hands the focus back to `+ add`', async ({ page }) => {
  await blockedTicket(page, 'Pickback');
  await page.keyboard.press('d');
  await expect(page.getByRole('combobox', { name: 'blocked by — search tickets' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
  await expect(page.getByTestId('add-depends_on')).toBeFocused();
});
