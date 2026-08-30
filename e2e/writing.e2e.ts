import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Issue 07's exit criterion: a design written into an always-live editor,
 * stored as markdown and read back by the same widget. Named to sort after
 * `transitions.e2e.ts` — one worker shares one database, and the earlier
 * specs address the tickets they made by key.
 */

const design = (page: Page) => page.getByTestId('design-tile').getByRole('textbox');

/**
 * Paste the way a person does: the editor decides the text is markdown, not
 * the clipboard. `html` is the highlighted flavour a code editor puts on the
 * clipboard beside the text — it must not stop the markdown from parsing.
 */
async function pasteMarkdown(field: Locator, markdown: string, html?: string) {
  await field.evaluate(
    (element, { text, html }) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      if (html) data.setData('text/html', html);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { text: markdown, html },
  );
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

  // a design copied out of a code editor arrives with a highlighted `text/html` beside the text; the text is still what counts
  await design(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await pasteMarkdown(design(page), '### From an editor\n\n- still a list\n', '<pre style="color:#abb2bf">### From an editor</pre>');
  await expect(design(page).locator('h3')).toHaveText('From an editor');
  await expect(design(page).locator('li')).toHaveText(['still a list']);

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

test('the mode line formats what is selected, links it, and is the only way back to a fence', async ({ page }) => {
  await newTicket(page, 'Format me');
  const tile = page.getByTestId('design-tile');
  const field = design(page);

  // the line is not chrome you have to live with: it is there while the caret is, and not before
  await expect(tile.getByTestId('mode-line')).toHaveCount(0);
  await field.click();
  await expect(tile.getByTestId('mode-line')).toBeVisible();

  await page.keyboard.type('the shape of it');
  await page.keyboard.press('ControlOrMeta+A');
  await tile.getByTestId('fmt-bold').click();
  await expect(field.locator('strong')).toHaveText('the shape of it');
  await expect(tile.getByTestId('fmt-bold')).toHaveAttribute('aria-pressed', 'true');

  // `link` turns the right slot into a URL field; the selection has to survive the caret leaving the document for it
  // (the same slot opens on `⌘K`, which Chrome reserves and Playwright's synthetic dispatch never delivers to the page)
  await tile.getByTestId('fmt-link').click();
  await tile.getByLabel('link url').fill('https://goblin.dev');
  await tile.getByLabel('link url').press('Enter');
  await expect(field.locator('a')).toHaveAttribute('href', 'https://goblin.dev');
});

test('every heading level is reachable, and a fence can be opened, named and taken back off', async ({ page }) => {
  await newTicket(page, 'Six levels and a fence');
  const tile = page.getByTestId('design-tile');
  const field = design(page);
  const url = page.url();
  await field.click();

  for (const level of [1, 2, 3, 4, 5, 6]) {
    if (level > 1) await page.keyboard.press('Enter');
    await tile.getByTestId(`fmt-h${level}`).click();
    await page.keyboard.type(`level ${level}`);
    await expect(field.locator(`h${level}`)).toHaveText(`level ${level}`);
  }

  // a fence swallows its own ``` — the mode line is where its language lives, and where you leave it
  await page.keyboard.press('Enter');
  await tile.getByTestId('fmt-codeBlock').click();
  await page.keyboard.type('const slice = 1;');
  await tile.getByLabel('code language').fill('ts');
  await expect(field.locator('pre code')).toHaveText('const slice = 1;');

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(tile.getByTestId('saving')).toHaveText('saved');
  const stored: string = await page.request.get(`/api/tickets/${url.split('/').pop()}`).then((r) => r.json()).then((t) => t.design);
  for (const level of [1, 2, 3, 4, 5, 6]) expect(stored).toContain(`${'#'.repeat(level)} level ${level}`);
  expect(stored).toContain('```ts');

  // and back off again: the only exit from a fence that is neither empty nor first in the document
  await field.locator('pre').click();
  await tile.getByTestId('fmt-codeBlock').click();
  await expect(field.locator('pre')).toHaveCount(0);
});
