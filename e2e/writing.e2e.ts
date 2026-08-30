import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Issue 07's exit criterion: a design written into an always-live editor,
 * stored as markdown and read back by the same widget. Named to sort after
 * `transitions.e2e.ts` — one worker shares one database, and the earlier
 * specs address the tickets they made by key.
 */

const design = (page: Page) => page.getByTestId('design-tile').getByRole('textbox');

/** Paste plain text the way a person does: the editor decides it is markdown, not the clipboard. */
async function pasteMarkdown(field: Locator, markdown: string) {
  await field.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, markdown);
}

async function newTicket(page: Page, title: string) {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  await page.getByTestId('new-ticket').getByLabel('ticket title').fill(title);
  await page.getByTestId('new-ticket').getByLabel('ticket title').press('ControlOrMeta+Enter');
  await page.locator('[data-testid^="card-"]', { hasText: title }).click();
  await expect(page.getByTestId('design-tile')).toBeVisible();
}

test('a ticket design is typed into the tile, saves itself, and comes back the same after a reload', async ({ page }) => {
  await newTicket(page, 'Write me a plan');
  const url = page.url();

  await design(page).click();
  await page.keyboard.type('# Slices\n');
  await page.keyboard.type('- parse the feed\n');
  await page.keyboard.type('render the list\n');
  // two returns leave the list; then a fence opens a code block
  await page.keyboard.press('Enter');
  await page.keyboard.type('```ts\n');
  await page.keyboard.type('const slice = 1;');

  // no save button: `⌘⏎` flushes and lets go, and the tile header says so
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('design-tile').getByTestId('saving')).toHaveText('saved');

  await page.reload();
  await expect(page.getByTestId('design-tile')).toBeVisible();
  await expect(design(page).locator('h1')).toHaveText('Slices');
  await expect(design(page).locator('li')).toHaveText(['parse the feed', 'render the list']);
  await expect(design(page).locator('pre code')).toHaveText('const slice = 1;');

  // markdown is the only stored form (ADR-0005) — this is what an agent reads
  const key = url.split('/').pop();
  const stored = await page.request.get(`/api/tickets/${key}`).then((r) => r.json());
  expect(stored.design).toContain('# Slices');
  expect(stored.design).toContain('- parse the feed');
  expect(stored.design).toContain('```ts');

  // the whole sitting is one history line, not one line per keystroke's worth of saving (ADR-0008)
  const events = await page.request.get(`/api/tickets/${key}/events`).then((r) => r.json());
  expect(events.filter((e: { kind: string }) => e.kind === 'updated')).toHaveLength(1);
  await expect(page.getByTestId('history').locator('li').first()).toContainText('design edited');
});

test('a design pasted as plain text arrives as markdown, and lets the ticket be approved', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  await page.getByTestId('new-app-form').getByLabel('name').fill('Paste target');
  await page.getByTestId('new-app-form').getByLabel('name').press('ControlOrMeta+Enter');

  await newTicket(page, 'Paste a plan into me');
  await design(page).click();
  await pasteMarkdown(design(page), '## What to build\n\n- [ ] the parser\n- [x] the fixtures\n\n> from the planner\n');
  await expect(design(page).locator('h2')).toHaveText('What to build');
  await expect(design(page).locator('blockquote')).toContainText('from the planner');
  await expect(design(page).locator('input[type="checkbox"]')).toHaveCount(2);

  await page.getByTestId('app-select').selectOption({ label: 'Paste target' });
  await page.getByTestId('move-plan').click();
  await page.getByTestId('move-approve').click();
  await expect(page.getByTestId('state-tile')).toContainText('ready');
});

test('a project design lives on the project view and is the same editor', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'new project' }).click();
  const form = page.getByTestId('new-project-form');
  await form.getByLabel('name').fill('Designed');
  await form.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('design-tile')).toBeVisible();

  await design(page).click();
  await page.keyboard.type('The shape of it, with **weight**.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('design-tile').getByTestId('saving')).toHaveText('saved');

  await page.reload();
  await expect(design(page).locator('strong')).toHaveText('weight');
  await expect(page.getByTestId('history').locator('li').first()).toContainText('design edited');
});
