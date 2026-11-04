import { expect, test } from '@playwright/test';
import type { APIResponse, Locator, Page } from '@playwright/test';

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
 * Click and wait until the caret is really there. The browser moves its selection at the click, but
 * ProseMirror reads it on `selectionchange`, which Chrome delivers once per frame, so a key sent as
 * soon as the DOM selection has moved acts on where the caret *was* (GF-75). Two frames lets it out.
 */
async function caretAt(target: Locator, selector: string, offset: number, position?: { x: number; y: number }) {
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
  await target.page().evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/**
 * Click into the field's one marked run. Its two revealed markers are drawn from ProseMirror's own
 * selection, so they are the proof it has caught up, which needs the caret to start off the run: the
 * first expectation holds the caller to that.
 */
async function caretInto(field: Locator, selector: string, offset: number, position: { x: number; y: number }) {
  const markers = field.locator('.gf-syntax');
  await expect(markers).toHaveCount(0);
  await caretAt(field.locator(selector), selector, offset, position);
  await expect(markers).toHaveCount(2);
}

/**
 * The click that focuses a field arms prosemirror-view's 20 ms focus timer, and a burst of keys can hold
 * it back until it fires among caret keys, where it writes the editor's stale caret over the browser's.
 * The idle save is a later, longer timer, so `saved` means it has already fired (LESSONS 2026-11-02, GF-94).
 */
const untilFocusTimerHasRun = (tile: Locator) => expect(tile.getByTestId('saving')).toHaveText('saved');

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

test('a numbered list on an empty field stores its one empty item, and the view survives the save and a reload (GF-100)', async ({ page }) => {
  await newTicket(page, 'Number me');
  const url = page.url();
  const tile = page.getByTestId('design-tile');
  const field = design(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await field.click();
  await tile.getByTestId('fmt-orderedList').click();
  await expect(field.locator('ol li')).toHaveCount(1);
  await page.waitForTimeout(BEAT_MS);
  expect(errors).toEqual([]);
  await expect(tile).toBeVisible();
  await expect(tile.getByTestId('saving')).toHaveText('saved');
  const key = url.split('/').pop();
  expect((await json<{ design: string }>(page.request.get(`/api/tickets/${key}`))).design).toBe('1. ');

  await page.reload();
  await expect(tile).toBeVisible();
  await expect(field.locator('ol li')).toHaveCount(1);
  expect(errors).toEqual([]);

  await field.locator('ol li').click();
  await page.keyboard.type('first');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(tile.getByTestId('saving')).toHaveText('saved');
  expect((await json<{ design: string }>(page.request.get(`/api/tickets/${key}`))).design).toBe('1. first');
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
  await untilFocusTimerHasRun(tile);
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

/** One long task queued to run next: the keys pressed meanwhile all land on thaw, at once. */
const freeze = (page: Page, ms: number) =>
  page.evaluate((ms) => {
    setTimeout(() => {
      const until = performance.now() + ms;
      while (performance.now() < until) {}
    }, 0);
  }, ms);

/** Longer than the 300 ms prosemirror-view counts a click as recent for, so the next focus is judged on its own. */
const HAND_MS = 350;

async function leaveField(page: Page, field: Locator) {
  // the editor reads a moved caret on the next selectionchange, and blur unhooks that (GF-75): two frames let it in first
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.getByTestId('page-title').click();
  await expect(field.locator('.gf-syntax')).toHaveCount(0);
  await page.waitForTimeout(HAND_MS);
}

/** A click at the line's far end, so the caret `e` restores is the end and not the document start. */
async function parkCaretAtLineEnd(page: Page, field: Locator) {
  const line = field.locator('p').first();
  const box = (await line.boundingBox())!;
  await line.click({ position: { x: box.width - 1, y: 6 } });
  await leaveField(page, field);
}

/** Rounds per spec: a race caught in most rounds, not every one, is caught in at least one. */
const ROUNDS = 3;
const byKey = (page: Page) => page.keyboard.press('e');
const byClickAtLineStart = (page: Page, field: Locator) => field.locator('p').first().click({ position: { x: 1, y: 6 } });

for (const [way, focus, keys, expected] of [
  ['`e`', byKey, ['ArrowLeft', 'ArrowLeft'], 'call parse nXow'],
  ['`e`, then Home', byKey, ['Home'], 'Xcall parse now'],
  ['a click at the line start', byClickAtLineStart, ['ArrowRight', 'ArrowRight'], 'caXll parse now'],
] as const)
  test(`caret keys pressed while the page is frozen right after ${way} puts the caret in the field still move it`, async ({ page }) => {
    const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: `Frozen after ${way}` } }));
    await json(page.request.patch(`/api/tickets/${ticket.key}`, { data: { design: 'call `parse` now' } }));
    await page.goto(`/tickets/${ticket.key}`);
    const field = design(page);
    await expect(field.locator('code')).toHaveText('parse');
    const writes = watchWrites(page);
    await parkCaretAtLineEnd(page, field);

    for (let round = 0; round < ROUNDS; round += 1) {
      await focus(page, field);
      await freeze(page, 150);
      for (const key of keys) await page.keyboard.press(key);
      await page.keyboard.type('X');
      await expect(field.locator('p').first()).toHaveText(expected);

      await page.keyboard.press('Backspace');
      await expect(field.locator('p').first()).toHaveText('call parse now');
      await parkCaretAtLineEnd(page, field);
    }
    expect(writes).toEqual([]);
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
  await caretInto(field, 'code', 0, { x: 0, y: 6 });

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
  // A compact desktop column: the editor's controls must fit its content-height tile.
  await page.setViewportSize({ width: 1600, height: 900 });
  await newTicket(page, 'Fills its tile');
  const tile = page.getByTestId('design-tile');
  const field = design(page);

  await field.click();
  await page.keyboard.type('one line');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(tile.getByTestId('mode-line')).toHaveCount(0);

  // The field stays clickable without borrowing height from its neighboring tile.
  const box = (await field.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(20);
  await page.mouse.click(box.x + 200, box.y + box.height - 8);
  await expect(tile.getByTestId('mode-line')).toBeVisible();

  // and the line is on the tile's bottom edge rather than crowding the text
  const tileBox = (await tile.boundingBox())!;
  const lineBox = (await tile.getByTestId('mode-line').boundingBox())!;
  const textBox = (await field.locator('p').first().boundingBox())!;
  expect(lineBox.y).toBeGreaterThanOrEqual(textBox.y + textBox.height);
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
  await caretInto(field, 'code', 'parse'.length, { x: run.width - 1, y: run.height / 2 });

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
  await caretInto(field, 'code', 0, { x: 0, y: 6 });

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

const ENDINGS = {
  'a list': 'Read me.\n\n- one\n- two\n',
  'an ordered list': 'Read me.\n\n1. one\n2. two\n',
  'a task list': 'Read me.\n\n- [ ] one\n- [x] two\n',
  'a heading': 'Read me.\n\n## The end\n',
  'a code block': 'Read me.\n\n```ts\nconst x = 1;\n```\n',
  'a blockquote': 'Read me.\n\n> the end\n',
  'a trailing newline': 'Read me.\n',
  'nothing': '',
} as const;

const json = async <T>(response: Promise<APIResponse>) => {
  const reply = await response;
  expect(reply.ok(), reply.url()).toBe(true);
  return (await reply.json()) as T;
};

const description = (page: Page) => page.getByTestId('description').locator('.gf-doc');

// past IDLE_MS in web/src/editor.tsx: a write the editor means to send has gone out by then
const BEAT_MS = 1000;

async function leave(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-line')).toHaveCount(0);
  await page.waitForTimeout(BEAT_MS);
}

async function caretThrough(page: Page, field: Locator) {
  await field.click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.waitForTimeout(BEAT_MS);
  await leave(page);
}

function watchWrites(page: Page): { path: string; body: unknown }[] {
  const writes: { path: string; body: unknown }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() as unknown });
  });
  return writes;
}

async function readsOnly(page: Page, path: string, read: () => Promise<void>) {
  const before = await json<unknown>(page.request.get(path));
  const events = await json<unknown[]>(page.request.get(`${path}/events`));
  const writes = watchWrites(page);
  await read();
  expect(writes).toEqual([]);
  await expect(page.getByTestId('saving')).toHaveCount(0);
  expect(await json<unknown>(page.request.get(path))).toEqual(before);
  expect(await json<unknown[]>(page.request.get(`${path}/events`))).toEqual(events);
}

for (const [ending, markdown] of Object.entries(ENDINGS)) {
  test(`reading a ticket whose description and design end in ${ending} writes nothing`, async ({ page }) => {
    const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: `Only read, ending in ${ending}`, description: markdown } }));
    await page.request.patch(`/api/tickets/${ticket.key}`, { data: { design: markdown } });
    await readsOnly(page, `/api/tickets/${ticket.key}`, async () => {
      await page.goto(`/tickets/${ticket.key}`);
      await caretThrough(page, description(page));
      await caretThrough(page, design(page));
    });
  });
}

/**
 * The project the cases here share, its fields rewritten per case: the one the
 * GUI made above, or one made here when this spec runs alone. The palette's
 * nested project pick shows eight rows, and a later spec picks its own project
 * from that list by name, so this spec adds no project of its own to a full run.
 */
async function sharedProject(page: Page, fields: { design: string; description?: string }) {
  const projects = await json<{ id: number }[]>(page.request.get('/api/projects'));
  const id = projects[0]?.id ?? (await json<{ id: number }>(page.request.post('/api/projects', { data: { name: 'Only read' } }))).id;
  await json(page.request.patch(`/api/projects/${id}`, { data: fields }));
  return { path: `/api/projects/${id}`, url: `/projects/${id}` };
}

for (const ending of ['a heading', 'a code block', 'a blockquote'] as const) {
  test(`reading a project's design ending in ${ending} writes nothing`, async ({ page }) => {
    const project = await sharedProject(page, { design: ENDINGS[ending] });
    await readsOnly(page, project.path, async () => {
      await page.goto(project.url);
      await caretThrough(page, design(page));
    });
  });
}

test("reading a project's design and description writes nothing", async ({ page }) => {
  const project = await sharedProject(page, { description: 'Read me, **briefly**.', design: ENDINGS['a list'] });
  await readsOnly(page, project.path, async () => {
    await page.goto(project.url);
    await caretThrough(page, design(page));
    await caretThrough(page, page.getByTestId('project-description').locator('.gf-doc'));
  });
});

test("reading an app's description writes nothing", async ({ page }) => {
  const app = await json<{ id: number }>(page.request.post('/api/apps', { data: { name: 'Only read', description: 'Read me, `briefly`.' } }));
  await readsOnly(page, `/api/apps/${app.id}`, async () => {
    await page.goto(`/apps/only-read-${app.id}`);
    await caretThrough(page, page.getByTestId('app-description').locator('.gf-doc'));
  });
});

test('an edit after the caret has sat in the field still saves, in one write', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Read, then written', description: ENDINGS['a list'] } }));
  await page.goto(`/tickets/${ticket.key}`);
  const writes = watchWrites(page);
  const field = description(page);
  await field.click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.waitForTimeout(BEAT_MS);

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Rewritten.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('saving')).toHaveText('saved');
  expect(writes).toEqual([{ path: `/api/tickets/${ticket.key}`, body: { description: 'Rewritten.' } }]);
});

test('a list that ends the field can still be written below, from the keyboard', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Listed to the end', description: ENDINGS['a list'] } }));
  await page.goto(`/tickets/${ticket.key}`);
  const field = description(page);

  await caretAt(field.locator('li').last(), 'li', 'two'.length);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Below the list.');
  await expect(field.locator('li')).toHaveText(['one', 'two']);
  await expect(field.locator('ul + p')).toHaveText('Below the list.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('saving')).toHaveText('saved');

  const after = await json<{ description: string }>(page.request.get(`/api/tickets/${ticket.key}`));
  expect(after.description).toBe('Read me.\n\n- one\n- two\n\nBelow the list.');
});

test('a code block that ends the field can still be written below, from the keyboard', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Fenced to the end', description: ENDINGS['a code block'] } }));
  await page.goto(`/tickets/${ticket.key}`);
  const field = description(page);

  await caretAt(field.locator('pre'), 'pre', 'const x = 1;'.length);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('After the fence.');
  await expect(field.locator('p').last()).toHaveText('After the fence.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('saving')).toHaveText('saved');

  const after = await json<{ description: string }>(page.request.get(`/api/tickets/${ticket.key}`));
  expect(after.description).toBe('Read me.\n\n```ts\nconst x = 1;\n```\n\nAfter the fence.');
});

test('arrowing out of a fence at either end of the field, then leaving, writes nothing', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Fenced both ends', description: '```ts\nconst x = 1;\n```\n' } }));
  await readsOnly(page, `/api/tickets/${ticket.key}`, async () => {
    await page.goto(`/tickets/${ticket.key}`);
    const field = description(page);
    await caretAt(field.locator('pre'), 'pre', 0, { x: 2, y: 6 });
    await page.keyboard.press('ArrowUp');
    await expect(field.locator('> :first-child')).toHaveText('');
    await caretAt(field.locator('pre'), 'pre', 'const x = 1;'.length);
    await page.keyboard.press('ArrowDown');
    await expect(field.locator('> :last-child')).toHaveText('');
    await page.waitForTimeout(BEAT_MS);
    await page.keyboard.press('ControlOrMeta+Z');
    await page.waitForTimeout(BEAT_MS);
    await leave(page);
  });
});

test('whitespace pasted into a field writes nothing', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Pasted nothing', description: ENDINGS['a list'] } }));
  await readsOnly(page, `/api/tickets/${ticket.key}`, async () => {
    await page.goto(`/tickets/${ticket.key}`);
    const field = description(page);
    await field.click();
    await pasteMarkdown(field, '   \n  \n');
    await expect(field.locator('li')).toHaveText(['one', 'two']);
    await page.waitForTimeout(BEAT_MS);
    await leave(page);
  });
});

test('a refetch reaches a field the caret sits in with nothing typed, once the caret leaves', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Rewritten underneath', description: ENDINGS['a list'] } }));
  await page.goto(`/tickets/${ticket.key}`);
  const writes = watchWrites(page);
  const field = description(page);
  await field.click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.waitForTimeout(BEAT_MS);

  await page.request.patch(`/api/tickets/${ticket.key}`, { data: { description: 'An agent rewrote this.' } });
  // what a window refocus does: the query client refetches on it
  const refetched = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/tickets/${ticket.key}`);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refetched;
  await expect(field.locator('li')).toHaveText(['one', 'two']);
  await page.keyboard.press('Escape');
  await expect(field).toHaveText('An agent rewrote this.');
  await page.waitForTimeout(BEAT_MS);
  expect(writes).toEqual([]);
  expect((await json<{ description: string }>(page.request.get(`/api/tickets/${ticket.key}`))).description).toBe('An agent rewrote this.');
});

interface Surface {
  path: string;
  url: string;
  field: Locator;
  saving: Locator;
  column: 'description' | 'design';
}

const savingIn = (page: Page, tile: 'about-tile' | 'design-tile') => page.getByTestId(tile).getByTestId('saving');

const SURFACES: Record<string, (page: Page, markdown: string) => Promise<Surface>> = {
  "a ticket's description": async (page, markdown) => {
    const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Written below', description: markdown } }));
    return { path: `/api/tickets/${ticket.key}`, url: `/tickets/${ticket.key}`, field: description(page), saving: savingIn(page, 'about-tile'), column: 'description' };
  },
  "a ticket's design": async (page, markdown) => {
    const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Written below' } }));
    await page.request.patch(`/api/tickets/${ticket.key}`, { data: { design: markdown } });
    return { path: `/api/tickets/${ticket.key}`, url: `/tickets/${ticket.key}`, field: design(page), saving: savingIn(page, 'design-tile'), column: 'design' };
  },
  "a project's design": async (page, markdown) => ({ ...(await sharedProject(page, { design: markdown })), field: design(page), saving: savingIn(page, 'design-tile'), column: 'design' }),
};

const stored = async (page: Page, surface: Surface) => (await json<Record<string, string>>(page.request.get(surface.path)))[surface.column];

/** Click under the closing block. The first click shows the line the editor keeps below it; the second puts the caret in it. */
async function caretBelow(field: Locator) {
  const box = (await field.boundingBox())!;
  await field.click({ position: { x: 24, y: box.height - 2 } });
  await caretAt(field.locator('> p').last(), 'p', 0);
  await expect(field.locator('> :last-child')).toHaveText('');
}

const LISTED = 'Read me.\n\n- one\n- two';

for (const [name, seed] of Object.entries(SURFACES)) {
  test(`a click below the list closing ${name} reaches a new line: left empty it writes nothing, typed in it saves`, async ({ page }) => {
    const surface = await seed(page, ENDINGS['a list']);
    await page.goto(surface.url);
    const writes = watchWrites(page);

    await caretBelow(surface.field);
    await page.waitForTimeout(BEAT_MS);
    await page.keyboard.press('ControlOrMeta+Z');
    await page.waitForTimeout(BEAT_MS);
    await leave(page);
    expect(writes).toEqual([]);
    expect(await stored(page, surface)).toBe(ENDINGS['a list']);

    await caretBelow(surface.field);
    await page.keyboard.type('Below the list.');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => stored(page, surface)).toBe(`${LISTED}\n\nBelow the list.`);
    expect(writes).toEqual([{ path: surface.path, body: { [surface.column]: `${LISTED}\n\nBelow the list.` } }]);
  });

  test(`text typed below the list closing ${name} and deleted again leaves the stored form, and undo never writes the empty line`, async ({ page }) => {
    const surface = await seed(page, ENDINGS['a list']);
    await page.goto(surface.url);
    const writes = watchWrites(page);
    const below = `${LISTED}\n\nBelow.`;

    await caretBelow(surface.field);
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(BEAT_MS);
    expect(writes).toEqual([]);

    await page.keyboard.type('Below.');
    await expect.poll(() => stored(page, surface)).toBe(below);
    // the server holds it before the field hears so, and a save's answer sends what the field holds by then, which here would be a word cut short
    await expect(surface.saving).toHaveText('saved');
    for (let i = 0; i < 'Below.'.length; i += 1) await page.keyboard.press('Backspace');
    await expect.poll(() => stored(page, surface)).toBe(LISTED);

    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => stored(page, surface)).toBe(below);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => stored(page, surface)).toBe(LISTED);
    await page.keyboard.press('ControlOrMeta+Z');
    await page.waitForTimeout(BEAT_MS);
    await leave(page);
    expect(writes).toEqual([below, LISTED, below, LISTED].map((body) => ({ path: surface.path, body: { [surface.column]: body } })));
    await expect(surface.field.locator('li')).toHaveText(['one', 'two']);
  });
}

for (const ending of ['a heading', 'a code block', 'a blockquote'] as const) {
  test(`a click below ${ending} closing a ticket's description reaches a new line, and what is typed there saves`, async ({ page }) => {
    const surface = await SURFACES["a ticket's description"]!(page, ENDINGS[ending]);
    await page.goto(surface.url);
    await caretBelow(surface.field);
    await page.keyboard.type('Below.');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => stored(page, surface)).toBe(`${ENDINGS[ending].trimEnd()}\n\nBelow.`);
  });
}
