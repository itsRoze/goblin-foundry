import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Issue 07's exit criterion: a design written into an always-live editor,
 * stored as markdown and read back by the same widget. Named to sort after
 * `transitions.e2e.ts` — one worker shares one database, and the earlier
 * specs address the tickets they made by key.
 */

const design = (page: Page) => page.getByTestId('design-tile').locator('.gf-doc');

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

/**
 * Click somewhere and wait until the caret is really there. `selectionchange` is asynchronous, so a
 * key pressed straight after a click acts on where the caret *was* — and the mode line is no help,
 * because "inside a code span" is true of every position in it. The browser's own selection is the
 * precise signal, and `waitForFunction` polls it.
 */
async function caretInto(target: Locator, selector: string, offset: number, position?: { x: number; y: number }) {
  await target.click(position ? { position } : undefined);
  await target.page().waitForFunction(
    ({ selector, offset }) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const node = selection.anchorNode;
      const host = node instanceof Element ? node : node?.parentElement;
      return selection.anchorOffset === offset && host?.closest(selector) != null;
    },
    { selector, offset },
  );
}

async function newTicket(page: Page, title: string) {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.keyboard.press('c');
  await page.getByTestId('board-create').getByLabel('ticket title').fill(title);
  await page.getByTestId('board-create').getByLabel('ticket title').press('ControlOrMeta+Enter');
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
  // that every level round-trips is `web/test/markdown.test.ts`'s job; here it only has to reach them and store something
  const stored: string = await page.request.get(`/api/tickets/${url.split('/').pop()}`).then((r) => r.json()).then((t) => t.design);
  expect(stored).toContain('# level 1');
  expect(stored).toContain('###### level 6');
  expect(stored).toContain('```ts');

  // and back off again: the exit from a fence that has content and is not the first thing in the document
  await field.locator('pre').click();
  await tile.getByTestId('fmt-codeBlock').click();
  await expect(field.locator('pre')).toHaveCount(0);
});

test('a mark can be taken off from inside it, with nothing selected', async ({ page }) => {
  await newTicket(page, 'Uncode me');
  const tile = page.getByTestId('design-tile');
  const field = design(page);
  await field.click();

  // the backticks are not in the document, so the caret is the only way to point at the span
  await page.keyboard.type('call `parse` now');
  await expect(field.locator('code')).toHaveText('parse');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
  await expect(tile.getByTestId('fmt-code')).toHaveAttribute('aria-pressed', 'true');

  await tile.getByTestId('fmt-code').click();
  await expect(field.locator('code')).toHaveCount(0);
  await expect(field.locator('p').first()).toHaveText('call parse now');

  // a selection still means exactly what it says, not the span around it
  await page.keyboard.press('ControlOrMeta+A');
  await tile.getByTestId('fmt-bold').click();
  await expect(field.locator('strong')).toHaveText('call parse now');
});

test('the markdown around a span shows itself when the caret is on it', async ({ page }) => {
  await newTicket(page, 'Show me the backticks');
  const field = design(page);
  await field.click();
  await page.keyboard.type('call `parse` and **hold** now');

  // rendered, the span hides where it begins and ends; markdown is the stored form, so say so
  const line = field.locator('p').first();
  await expect(line).toHaveText('call parse and hold now');

  await field.locator('code').dblclick();
  await expect(line).toHaveText('call `parse` and hold now');

  await field.locator('strong').dblclick();
  await expect(line).toHaveText('call parse and **hold** now');

  // they are decorations, not text: what is stored has exactly one pair of each
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('design-tile').getByTestId('saving')).toHaveText('saved');
  const stored: string = await page.request
    .get(`/api/tickets/${page.url().split('/').pop()}`)
    .then((r) => r.json())
    .then((t) => t.design);
  expect(stored.trim()).toBe('call `parse` and **hold** now');

  // and with the caret away from both, the line reads as prose again
  await expect(field.locator('.gf-syntax')).toHaveCount(0);

  // clicking away is the other way to leave: a field you are not in has no caret, so it has no markers
  await field.locator('code').dblclick();
  await expect(line).toHaveText('call `parse` and hold now');
  await page.getByTestId('page-title').click();
  await expect(field.locator('.gf-syntax')).toHaveCount(0);
  await expect(line).toHaveText('call parse and hold now');
});

test('the link slot cancels when told to, and lands its url exactly once', async ({ page }) => {
  await newTicket(page, 'Link twice');
  const tile = page.getByTestId('design-tile');
  const field = design(page);
  await field.click();

  // esc is cancel: whatever was typed into the slot does not become a link
  await page.keyboard.type('cancel me');
  await page.keyboard.press('ControlOrMeta+A');
  await tile.getByTestId('fmt-link').click();
  await tile.getByLabel('link url').fill('https://nope.dev');
  await tile.getByLabel('link url').press('Escape');
  // the slot closing is not enough: the keys that follow need the caret actually back in the document
  await expect(tile.getByLabel('link url')).toHaveCount(0);
  await expect(field).toBeFocused();
  await expect(field.locator('a')).toHaveCount(0);

  // with nothing selected the url becomes its own link text — once, not twice
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(field).toHaveText('');
  await tile.getByTestId('fmt-link').click();
  await tile.getByLabel('link url').fill('https://once.dev');
  await tile.getByLabel('link url').press('Enter');
  await expect(field.locator('a')).toHaveCount(1);
  await expect(field.locator('a')).toHaveText('https://once.dev');
});

test('the keys the mode line advertises do what its buttons do', async ({ page }) => {
  await newTicket(page, 'By keyboard alone');
  const tile = page.getByTestId('design-tile');
  const field = design(page);
  await field.click();
  await page.keyboard.type('hold this');
  await page.keyboard.press('ControlOrMeta+A');

  // the same whole-span rule as the buttons, since these bindings are taken over from the schema's own
  // (`⌘K` is not here: Chrome reserves it and Playwright's synthetic dispatch never delivers it to the page)
  await page.keyboard.press('ControlOrMeta+b');
  await expect(field.locator('strong')).toHaveText('hold this');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(field.locator('em')).toHaveText('hold this');
  await page.keyboard.press('ControlOrMeta+e');
  await expect(field.locator('code')).toHaveText('hold this');
  await expect(tile.getByTestId('fmt-code')).toHaveAttribute('aria-pressed', 'true');

  // from inside the span, with nothing selected — the reason the bindings are ours and not the schema's
  await field.locator('code').click();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(field.locator('code')).toHaveCount(0);
});

test('a fence that opens the document can still be got out of, upwards', async ({ page }) => {
  await newTicket(page, 'Fence first');
  const field = design(page);
  await field.click();

  // a design pasted from a planner can begin with a fence, and then there is no line above it to click.
  // Opened empty, so the caret is at its first position by construction rather than by aiming a click there.
  await page.keyboard.type('```ts\n');
  await expect(field.locator('pre')).toHaveCount(1);

  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('a line above it');
  await expect(field.locator('p').first()).toHaveText('a line above it');
  await expect(field.locator('pre')).toHaveCount(1);
});

test('backspace against a revealed marker deletes the marker, then the character under it', async ({ page }) => {
  await newTicket(page, 'Backspace the backtick');
  const field = design(page);
  await field.click();
  // the run opens the line, so at its opening edge the caret is inside it and the marker is drawn behind
  await page.keyboard.type('`parse` now');
  await expect(field.locator('code')).toHaveText('parse');
  await caretInto(field.locator('code'), 'code', 0, { x: 0, y: 6 });

  // the first press deletes the marker, which is to say it takes the mark off the run; no text goes
  await page.keyboard.press('Backspace');
  await expect(field.locator('code')).toHaveCount(0);
  await expect(field.locator('p').first()).toHaveText('parse now');

  // the second is an ordinary backspace again — and there is nothing before it, so nothing happens
  await page.keyboard.type('X');
  await page.keyboard.press('Backspace');
  await expect(field.locator('p').first()).toHaveText('parse now');
});

test('the design field owns its tile: the mode line sits on the tile edge, not under the last line written', async ({ page }) => {
  // two columns, so the design tile is stretched by the row and has room to fill (DESIGN.md Layout)
  await page.setViewportSize({ width: 1600, height: 900 });
  await newTicket(page, 'Fills its tile');
  const tile = page.getByTestId('design-tile');
  const field = design(page);

  await field.click();
  await page.keyboard.type('one line');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(tile.getByTestId('mode-line')).toHaveCount(0);

  // the tile is all field: clicking far below the only line still puts the caret in it
  const box = (await field.boundingBox())!;
  expect(box.height).toBeGreaterThan(100);
  await page.mouse.click(box.x + 200, box.y + box.height - 8);
  await expect(tile.getByTestId('mode-line')).toBeVisible();

  // and the line is on the tile's bottom edge rather than crowding the text
  const tileBox = (await tile.boundingBox())!;
  const lineBox = (await tile.getByTestId('mode-line').boundingBox())!;
  expect(tileBox.y + tileBox.height - (lineBox.y + lineBox.height)).toBeLessThan(24);
});

test('backspace inside a run deletes a character, not the whole run', async ({ page }) => {
  await newTicket(page, 'Backspace inside');
  const field = design(page);
  await field.click();
  await page.keyboard.type('call `parse` now');

  // the caret sits after the last character of the run, where the closing marker is drawn on its far side:
  // there is no marker against it, so backspace is an ordinary backspace
  const run = (await field.locator('code').boundingBox())!;
  await caretInto(field.locator('code'), 'code', 'parse'.length, { x: run.width - 1, y: run.height / 2 });

  await page.keyboard.press('Backspace');
  await expect(field.locator('code')).toContainText('pars');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('design-tile').getByTestId('saving')).toHaveText('saved');
  const stored: string = await page.request
    .get(`/api/tickets/${page.url().split('/').pop()}`)
    .then((r) => r.json())
    .then((t) => t.design);
  expect(stored.trim()).toBe('call `pars` now');
});

test('a run that opens the line can be arrowed out of, and typing there is plain again', async ({ page }) => {
  await newTicket(page, 'Escape the backtick');
  const field = design(page);
  await field.click();

  // the whole line is one code span, so there is no position to its left to arrow into
  await page.keyboard.type('`test` ');
  await expect(field.locator('code')).toHaveText('test');
  await caretInto(field.locator('code'), 'code', 0, { x: 0, y: 6 });

  // the arrow does not move the caret, it steps it outside the mark: what comes next is no longer code
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('call ');

  // asserted with the caret away, because a revealed marker is part of what the run renders as
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(field.locator('.gf-syntax')).toHaveCount(0);
  await expect(field.locator('code')).toHaveText('test');
  await expect(page.getByTestId('design-tile').getByTestId('saving')).toHaveText('saved');
  const after: string = await page.request
    .get(`/api/tickets/${page.url().split('/').pop()}`)
    .then((r) => r.json())
    .then((t) => t.design);
  expect(after.trim()).toBe('call `test`');
});

test('a url pasted over a selection links it, and a link opens when clicked', async ({ page, context }) => {
  await newTicket(page, 'Link by paste');
  const field = design(page);
  await field.click();
  await page.keyboard.type('the planner');
  await page.keyboard.press('ControlOrMeta+A');

  // the clipboard holding a url and text selected is the commonest way to make a link; no slot needed
  await pasteMarkdown(field, 'https://goblin.dev/planner');
  await expect(field.locator('a')).toHaveText('the planner');
  await expect(field.locator('a')).toHaveAttribute('href', 'https://goblin.dev/planner');

  // and it survives as a markdown link
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('design-tile').getByTestId('saving')).toHaveText('saved');
  const stored: string = await page.request
    .get(`/api/tickets/${page.url().split('/').pop()}`)
    .then((r) => r.json())
    .then((t) => t.design);
  expect(stored.trim()).toBe('[the planner](https://goblin.dev/planner)');

  // the field is the read view too (ADR-0005), so the link has to be followable
  const opened = context.waitForEvent('page');
  await field.locator('a').click();
  expect((await opened).url()).toBe('https://goblin.dev/planner');
});
