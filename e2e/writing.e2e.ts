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
 * Click into the field's one marked run and wait until the editor has the caret there. The browser
 * moves its selection at the click, but ProseMirror reads it on `selectionchange`, which Chrome
 * delivers once per frame, so a key sent as soon as the DOM selection has moved acts on where the
 * caret *was* (GF-75). The DOM selection gives the exact offset; the run's two revealed markers are
 * drawn from ProseMirror's own selection, so they are the proof it has caught up. That proof needs
 * the caret to start off the run, which the first expectation holds the caller to.
 */
async function caretInto(field: Locator, selector: string, offset: number, position: { x: number; y: number }) {
  const markers = field.locator('.gf-syntax');
  await expect(markers).toHaveCount(0);
  await field.locator(selector).click({ position });
  await field.page().waitForFunction(
    ({ selector, offset }) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const node = selection.anchorNode;
      const host = node instanceof Element ? node : node?.parentElement;
      return selection.anchorOffset === offset && host?.closest(selector) != null;
    },
    { selector, offset },
  );
  await expect(markers).toHaveCount(2);
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
  test.fixme(!!process.env.CI, 'fails on Linux CI (GF-73)');
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

/** One case per ending: what wrote (GF-43) was a paragraph appended after a closing block that is not one, so a list fails where plain text does not. */
const ENDINGS = {
  'a list': 'Read me.\n\n- one\n- two\n',
  'a heading': 'Read me.\n\n## The end\n',
  'a code block': 'Read me.\n\n```ts\nconst x = 1;\n```\n',
  'a blockquote': 'Read me.\n\n> the end\n',
  'a trailing newline': 'Read me.\n',
  'nothing': '',
} as const;

const json = async <T>(response: Promise<{ json(): Promise<unknown> }>) => (await (await response).json()) as T;

async function caretThrough(page: Page, field: Locator) {
  await field.click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  // longer than the editor's idle beat (750ms), once with the caret in and once after a blur
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-line')).toHaveCount(0);
  await page.waitForTimeout(1000);
}

/** `read` the entity at `path` in the browser; afterwards the server holds exactly what it held, and no PATCH went out. */
function watchWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes.push(`PATCH ${new URL(request.url()).pathname} ${request.postData() ?? ''}`);
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
      await caretThrough(page, page.getByTestId('description').locator('.gf-doc'));
      await caretThrough(page, design(page));
    });
  });
}

for (const ending of ['a heading', 'a code block', 'a blockquote'] as const) {
  test(`reading a project's design ending in ${ending} writes nothing`, async ({ page }) => {
    const project = await json<{ id: number }>(page.request.post('/api/projects', { data: { name: 'Only read', design: ENDINGS[ending] } }));
    await readsOnly(page, `/api/projects/${project.id}`, async () => {
      await page.goto(`/projects/only-read-${project.id}`);
      await caretThrough(page, design(page));
    });
  });
}

test("reading a project's design and description writes nothing", async ({ page }) => {
  const project = await json<{ id: number }>(
    page.request.post('/api/projects', { data: { name: 'Only read', description: 'Read me, **briefly**.', design: ENDINGS['a list'] } }),
  );
  await readsOnly(page, `/api/projects/${project.id}`, async () => {
    await page.goto(`/projects/only-read-${project.id}`);
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
  const field = page.getByTestId('description').locator('.gf-doc');
  await field.click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.waitForTimeout(1000);

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Rewritten.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('saving')).toHaveText('saved');
  expect(writes).toEqual([`PATCH /api/tickets/${ticket.key} {"description":"Rewritten."}`]);
});

test('a list that ends the field can still be written below, from the keyboard', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Listed to the end', description: ENDINGS['a list'] } }));
  await page.goto(`/tickets/${ticket.key}`);
  const field = page.getByTestId('description').locator('.gf-doc');

  await caretInto(field.locator('li').last(), 'li', 'two'.length);
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
  const field = page.getByTestId('description').locator('.gf-doc');

  await caretInto(field.locator('pre'), 'pre', 'const x = 1;'.length);
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
    const field = page.getByTestId('description').locator('.gf-doc');
    await caretInto(field.locator('pre'), 'pre', 0, { x: 2, y: 6 });
    await page.keyboard.press('ArrowUp');
    await expect(field.locator('> :first-child')).toHaveText('');
    await caretInto(field.locator('pre'), 'pre', 'const x = 1;'.length);
    await page.keyboard.press('ArrowDown');
    await expect(field.locator('> :last-child')).toHaveText('');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  });
});

test('whitespace pasted into a field writes nothing', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Pasted nothing', description: ENDINGS['a list'] } }));
  await readsOnly(page, `/api/tickets/${ticket.key}`, async () => {
    await page.goto(`/tickets/${ticket.key}`);
    const field = page.getByTestId('description').locator('.gf-doc');
    await field.click();
    await pasteMarkdown(field, '   \n  \n');
    await expect(field.locator('li')).toHaveText(['one', 'two']);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  });
});

test('a refetch reaches a field the caret sits in with nothing typed, once the caret leaves', async ({ page }) => {
  const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Rewritten underneath', description: ENDINGS['a list'] } }));
  await page.goto(`/tickets/${ticket.key}`);
  const writes = watchWrites(page);
  const field = page.getByTestId('description').locator('.gf-doc');
  await field.click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.waitForTimeout(1000);

  await page.request.patch(`/api/tickets/${ticket.key}`, { data: { description: 'An agent rewrote this.' } });
  // what a window refocus does: the query client refetches on it
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1000);
  // never under the caret
  await expect(field.locator('li')).toHaveText(['one', 'two']);
  await page.keyboard.press('Escape');
  await expect(field).toHaveText('An agent rewrote this.');
  await page.waitForTimeout(1000);
  expect(writes).toEqual([]);
  expect((await json<{ description: string }>(page.request.get(`/api/tickets/${ticket.key}`))).description).toBe('An agent rewrote this.');
});

/** Where a block field lives: seeded over the API, read back from `path`, found on its page. */
interface Surface {
  path: string;
  url: string;
  field: Locator;
  column: 'description' | 'design';
}

const SURFACES: Record<string, (page: Page, markdown: string) => Promise<Surface>> = {
  "a ticket's description": async (page, markdown) => {
    const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Written below', description: markdown } }));
    return { path: `/api/tickets/${ticket.key}`, url: `/tickets/${ticket.key}`, field: page.getByTestId('description').locator('.gf-doc'), column: 'description' };
  },
  "a ticket's design": async (page, markdown) => {
    const ticket = await json<{ key: string }>(page.request.post('/api/tickets', { data: { title: 'Written below' } }));
    await page.request.patch(`/api/tickets/${ticket.key}`, { data: { design: markdown } });
    return { path: `/api/tickets/${ticket.key}`, url: `/tickets/${ticket.key}`, field: design(page), column: 'design' };
  },
  "a project's design": async (page, markdown) => {
    const project = await json<{ id: number }>(page.request.post('/api/projects', { data: { name: 'Written below', design: markdown } }));
    return { path: `/api/projects/${project.id}`, url: `/projects/written-below-${project.id}`, field: design(page), column: 'design' };
  },
};

const stored = async (page: Page, surface: Surface) => (await json<Record<string, string>>(page.request.get(surface.path)))[surface.column];

/** Click under the closing block. The first click shows the line the editor keeps below it; the second puts the caret in it. */
async function caretBelow(field: Locator) {
  const box = (await field.boundingBox())!;
  await field.click({ position: { x: 24, y: box.height - 2 } });
  await caretInto(field.locator('> p').last(), 'p', 0);
  await expect(field.locator('> :last-child')).toHaveText('');
}

const LISTED = 'Read me.\n\n- one\n- two';

for (const [name, seed] of Object.entries(SURFACES)) {
  test(`a click below the list closing ${name} reaches a new line: left empty it writes nothing, typed in it saves`, async ({ page }) => {
    const surface = await seed(page, ENDINGS['a list']);
    await page.goto(surface.url);
    const writes = watchWrites(page);

    await caretBelow(surface.field);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    expect(writes).toEqual([]);
    expect(await stored(page, surface)).toBe(ENDINGS['a list']);

    await caretBelow(surface.field);
    await page.keyboard.type('Below the list.');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => stored(page, surface)).toBe(`${LISTED}\n\nBelow the list.`);
    expect(writes).toEqual([`PATCH ${surface.path} {"${surface.column}":"${LISTED.replace(/\n/g, '\\n')}\\n\\nBelow the list."}`]);
  });

  test(`text typed below the list closing ${name} and deleted again leaves the stored form, and undo never writes the empty line`, async ({ page }) => {
    const surface = await seed(page, ENDINGS['a list']);
    await page.goto(surface.url);
    const writes = watchWrites(page);
    const below = `${LISTED}\n\nBelow.`;

    await caretBelow(surface.field);
    await page.keyboard.type('Below.');
    await expect.poll(() => stored(page, surface)).toBe(below);
    for (let i = 0; i < 'Below.'.length; i += 1) await page.keyboard.press('Backspace');
    await expect.poll(() => stored(page, surface)).toBe(LISTED);

    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => stored(page, surface)).toBe(below);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => stored(page, surface)).toBe(LISTED);
    // the last undo takes back the line itself, which is not content
    await page.keyboard.press('ControlOrMeta+Z');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    expect(writes.map((w) => w.slice(w.indexOf('{')))).toEqual([below, LISTED, below, LISTED].map((d) => JSON.stringify({ [surface.column]: d })));
    await expect(surface.field.locator('li')).toHaveText(['one', 'two']);
  });
}
