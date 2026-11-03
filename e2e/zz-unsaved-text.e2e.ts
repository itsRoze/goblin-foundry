import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';
import type { TiptapEditorHTMLElement } from '@tiptap/core';

/**
 * Text a person typed is never silently lost (GF-79, GF-83). It may be
 * unsaved, and then the field still holds it and says so. Each case here is a
 * route by which the words used to vanish: a write the API never answers, one
 * it refuses, one still out when the view that sent it is gone. Named to run
 * after the desktop specs, whose palette rows these apps and projects would
 * crowd.
 */

type Ticket = { key: string; title: string; description: string };
type Named = { id: number; name: string };

const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;
const read = async <T>(page: Page, path: string) => (await (await page.request.get(path)).json()) as T;

const expectTitle = (page: Page, text: string) => expect(page.getByTestId('page-title')).toContainText(text);

const UNREACHED = 'could not reach the API; try again';
const MOVED = 'changed elsewhere while unsaved; in the field, ⌘⏎ saves yours, esc takes theirs';

// past IDLE_MS in web/src/editor.tsx: a write the editor means to send has gone out by then
const BEAT_MS = 1000;
// PATCH_BOUND_MS in web/src/api.ts: a save with no answer by then has been given up on
const BOUND_MS = 10_000;

const doc = (page: Page, testId: string) => page.getByTestId(testId).locator('.gf-doc');
const refusal = (page: Page, testId: string) => page.getByTestId(testId).getByRole('alert');

function patchesSent(page: Page) {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') sent.push(request.postData() ?? '');
  });
  return sent;
}

async function hangFirstPatch(page: Page, path: string) {
  let hang = true;
  await page.route(path, (route) => {
    if (!isPatch(route) || !hang) return route.continue();
    hang = false;
  });
}

async function hideTab(page: Page, hidden: boolean) {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden ? 'hidden' : 'visible');
}

async function clickPastTheWords(page: Page, line: Locator) {
  const { width, height } = (await line.boundingBox())!;
  await line.click({ position: { x: width - 1, y: height / 2 } });
  await expect(page.getByTestId('mode-line')).toBeVisible();
}

async function typeAtEnd(page: Page, testId: string, words: string, line = doc(page, testId)) {
  await clickPastTheWords(page, line);
  await page.keyboard.type(words);
}

async function leave(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-line')).toHaveCount(0);
}

const isPatch = (route: Route) => route.request().method() === 'PATCH';

/** One field on one view: where it is on screen, where its body is in the API, and the view's title for the palette. */
interface Surface {
  title: string;
  url: string;
  path: string;
  column: string;
  testId: string;
}

const stored = async (page: Page, surface: Surface) => (await read<Record<string, string>>(page, surface.path))[surface.column];

const SURFACES: Record<string, (page: Page, name: string) => Promise<Surface>> = {
  'a ticket description': async (page, name) => {
    const ticket = await post<Ticket>(page, '/api/tickets', { title: `${name} ticket`, description: `${name} origin words` });
    return { title: ticket.title, url: `/tickets/${ticket.key}`, path: `/api/tickets/${ticket.key}`, column: 'description', testId: 'description' };
  },
  'a project design': async (page, name) => {
    const project = await post<Named>(page, '/api/projects', { name: `${name} project`, design: `${name} origin words` });
    return { title: project.name, url: `/projects/${project.id}`, path: `/api/projects/${project.id}`, column: 'design', testId: 'design' };
  },
  'an app description': async (page, name) => {
    const app = await post<Named>(page, '/api/apps', { name: `${name} app`, description: `${name} origin words` });
    return { title: app.name, url: `/apps/${app.id}`, path: `/api/apps/${app.id}`, column: 'description', testId: 'app-description' };
  },
};

/**
 * On `first`, with `second` one step forward in history and both in the query
 * cache, so leaving and returning never passes through a loading render: that
 * path starts the field clean and passes for the wrong reason (LESSONS.md, GF-76).
 */
async function onFirstWithSecondAhead(page: Page, first: Surface, second: Surface) {
  await page.goto(first.url);
  await expectTitle(page, first.title);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill(second.title);
  await expect(page.getByTestId('palette').getByText(second.title)).toBeVisible();
  await page.keyboard.press('Enter');
  await expectTitle(page, second.title);
  await page.goBack();
  await expectTitle(page, first.title);
}

test('a save the API never answers says so in a sentence, and the words stay in the field (GF-79)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Unreached');
  await page.goto(surface.url);
  // a flag, not `unroute`: taking a route down while requests are in flight through it leaves them hanging, which is Playwright's and not the app's
  let unreachable = true;
  await page.route(surface.path, (route) => (isPatch(route) && unreachable ? route.abort() : route.continue()));

  await typeAtEnd(page, surface.testId, ' kept');
  await expect(refusal(page, surface.testId)).toBeVisible();
  await expect(doc(page, surface.testId)).toHaveText('Unreached origin words kept');
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED);

  unreachable = false;
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Unreached origin words kept');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

for (const [name, make] of Object.entries(SURFACES)) {
  test(`words whose save fails after leaving ${name} are there, with the refusal, on the way back (GF-79)`, async ({ page }) => {
    const first = await make(page, `Lostwords ${name.split(' ')[1]}`);
    const second = await make(page, `Besidewords ${name.split(' ')[1]}`);
    await onFirstWithSecondAhead(page, first, second);
    let unreachable = true;
    await page.route(first.path, (route) => (isPatch(route) && unreachable ? route.abort() : route.continue()));

    await typeAtEnd(page, first.testId, ' stray');
    const failed = page.waitForEvent('requestfailed', (request) => request.method() === 'PATCH');
    await page.goForward();
    await expectTitle(page, second.title);
    await failed;

    await page.goBack();
    await expectTitle(page, first.title);
    await expect(doc(page, first.testId)).toHaveText(`${first.title.replace(/ \w+$/, '')} origin words stray`);
    await expect(refusal(page, first.testId)).toHaveText(UNREACHED);

    unreachable = false;
    await doc(page, first.testId).click();
    await leave(page);
    await expect.poll(() => stored(page, first)).toBe(`${first.title.replace(/ \w+$/, '')} origin words stray`);
    await expect(refusal(page, first.testId)).toHaveCount(0);
  });
}

test('a 409 on the blur save keeps the words, and once the other writer’s body is read the field says it moved; typing then replaces it (GF-79)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Conflicted');
  const key = surface.path.split('/').at(-1);
  await page.goto(surface.url);
  const hint = `nothing changed — ticket ${key} changed while the edit was being applied; try again`;
  let refused = false;
  await page.route(surface.path, async (route) => {
    if (!isPatch(route) || refused) return route.continue();
    refused = true;
    await page.request.patch(surface.path, { data: { description: 'rewritten underneath' } });
    await route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Conflict', hint }) });
  });

  await typeAtEnd(page, surface.testId, ' mine');
  const refetched = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === surface.path);
  await leave(page);
  await refetched;
  await expect(doc(page, surface.testId)).toHaveText('Conflicted origin words mine');
  await expect(refusal(page, surface.testId)).toHaveText(MOVED);

  await typeAtEnd(page, surface.testId, ' more');
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Conflicted origin words mine more');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

test('a save the API never answers is given up on, says so, and the next write goes out once the API answers again (GF-79)', async ({ page }) => {
  test.setTimeout(BOUND_MS + 30_000);
  const surface = await SURFACES['a ticket description'](page, 'Hung');
  await page.goto(surface.url);
  const sent = patchesSent(page);
  await hangFirstPatch(page, surface.path);

  await typeAtEnd(page, surface.testId, ' one');
  await leave(page);
  await expect(page.getByTestId('saving')).toHaveText('saving…');
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED, { timeout: BOUND_MS + 5_000 });
  await expect(doc(page, surface.testId)).toHaveText('Hung origin words one');
  await expect(page.getByTestId('saving')).toHaveCount(0);

  await typeAtEnd(page, surface.testId, ' two');
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Hung origin words one two');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  expect(sent).toEqual(['{"description":"Hung origin words one"}', '{"description":"Hung origin words one two"}']);
});

test('a save that never answers, left and come back to, is given up on in its field, and the next act sends the words (GF-79)', async ({ page }) => {
  test.setTimeout(BOUND_MS + 30_000);
  const first = await SURFACES['a ticket description'](page, 'Hungaway');
  const second = await SURFACES['a ticket description'](page, 'Hungbeside');
  await onFirstWithSecondAhead(page, first, second);
  await hangFirstPatch(page, first.path);

  const hung = page.waitForRequest((request) => request.method() === 'PATCH');
  await typeAtEnd(page, first.testId, ' one');
  await hung;
  await page.goForward();
  await expectTitle(page, second.title);
  await page.goBack();
  await expectTitle(page, first.title);
  await expect(doc(page, first.testId)).toHaveText('Hungaway origin words one');
  await expect(refusal(page, first.testId)).toHaveText(UNREACHED, { timeout: BOUND_MS + 5_000 });

  await doc(page, first.testId).click();
  await leave(page);
  await expect.poll(() => stored(page, first)).toBe('Hungaway origin words one');
  await expect(refusal(page, first.testId)).toHaveCount(0);
});

test('a save given up on cannot land over a later one: the API refuses it on what the field held when it was judged (GF-79)', async ({ page }) => {
  test.setTimeout(BOUND_MS + 30_000);
  const surface = await SURFACES['a ticket description'](page, 'Late');
  const key = surface.path.split('/').at(-1);
  await page.goto(surface.url);
  await hangFirstPatch(page, surface.path);

  const held = page.waitForRequest((request) => request.method() === 'PATCH');
  await typeAtEnd(page, surface.testId, ' one');
  await leave(page);
  const request = await held;
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED, { timeout: BOUND_MS + 5_000 });
  await typeAtEnd(page, surface.testId, ' two');
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Late origin words one two');

  const judged = (await request.allHeaders())['x-goblin-judged'];
  expect(judged).toMatch(/^description=[0-9a-f]{16}$/);
  const late = await page.request.patch(surface.path, { data: request.postData() ?? '', headers: { 'content-type': 'application/json', 'x-goblin-judged': judged } });
  expect([late.status(), (await late.json()).hint]).toEqual([409, `nothing changed — ticket ${key} changed while the edit was being applied; try again`]);
  expect(await stored(page, surface)).toBe('Late origin words one two');
});

test('a save given up on that lands after all is the person’s own words, not a move: the next write goes out on it with no sentence (GF-79)', async ({ page }) => {
  test.setTimeout(BOUND_MS + 30_000);
  const surface = await SURFACES['a ticket description'](page, 'Lateown');
  await page.goto(surface.url);
  const sent = patchesSent(page);
  await hangFirstPatch(page, surface.path);

  const held = page.waitForRequest((request) => request.method() === 'PATCH');
  await typeAtEnd(page, surface.testId, ' one');
  await leave(page);
  const request = await held;
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED, { timeout: BOUND_MS + 5_000 });
  await page.request.patch(surface.path, { data: request.postData() ?? '', headers: { 'content-type': 'application/json' } });
  expect(await stored(page, surface)).toBe('Lateown origin words one');

  await typeAtEnd(page, surface.testId, ' two');
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Lateown origin words one two');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  await expect(doc(page, surface.testId)).toHaveText('Lateown origin words one two');
  const refusedOnceThenSentAgain = ['{"description":"Lateown origin words one"}', '{"description":"Lateown origin words one two"}', '{"description":"Lateown origin words one two"}'];
  expect(sent).toEqual(refusedOnceThenSentAgain);
});

/** A link on which a save takes `ms` to arrive, so another write to the row can land inside its round trip. */
async function slowPatches(page: Page, path: string, ms: number) {
  await page.route(path, async (route) => {
    if (isPatch(route)) await new Promise((done) => setTimeout(done, ms));
    await route.continue();
  });
}

const LINK_MS = 400;

for (const [name, make] of Object.entries(SURFACES).filter(([n]) => n !== 'an app description')) {
  test(`two fields of ${name.split(' ')[1]} saved over each other on a slow link both land, with no refusal (GF-79)`, async ({ page }) => {
    const kind = name.split(' ')[1];
    const first = await make(page, `Twofields ${kind}`);
    const other = first.column === 'design' ? { ...first, column: 'description', testId: 'project-description' } : { ...first, column: 'design', testId: 'design' };
    await page.goto(first.url);
    await slowPatches(page, first.path, LINK_MS);

    await typeAtEnd(page, first.testId, ' one');
    await typeAtEnd(page, other.testId, 'two');
    await leave(page);
    await expect.poll(() => stored(page, first)).toBe(`Twofields ${kind} origin words one`);
    await expect.poll(() => stored(page, other)).toBe('two');
    await expect(refusal(page, first.testId)).toHaveCount(0);
    await expect(refusal(page, other.testId)).toHaveCount(0);
  });
}

test('a label, a move, a title and another writer’s title landing inside a body save on a slow link refuse nothing (GF-79)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Rowmoves');
  await page.goto(surface.url);
  await slowPatches(page, surface.path, LINK_MS);

  await typeAtEnd(page, surface.testId, ' one');
  await page.getByTestId('add-label').click();
  await page.getByLabel('add labels, comma-separated').fill('x');
  await page.getByLabel('add labels, comma-separated').press('Enter');
  await expect.poll(() => stored(page, surface)).toBe('Rowmoves origin words one');
  await expect(page.getByTestId('labels-refusal')).toHaveCount(0);

  await typeAtEnd(page, surface.testId, ' two');
  await page.getByTestId('move-pick').click();
  await expect.poll(() => stored(page, surface)).toBe('Rowmoves origin words one two');
  await expect(page.getByTestId('state-refusal')).toHaveCount(0);

  await typeAtEnd(page, surface.testId, ' three');
  await page.getByTestId('ticket-title').click();
  await page.getByRole('textbox', { name: 'title' }).fill('Rowmoves ticket renamed');
  await page.getByRole('textbox', { name: 'title' }).press('ControlOrMeta+Enter');
  await expect.poll(() => stored(page, surface)).toBe('Rowmoves origin words one two three');

  await page.request.patch(surface.path, { data: { title: 'Rowmoves ticket by agent' }, headers: { 'x-goblin-actor': 'agent' } });
  await typeAtEnd(page, surface.testId, ' four');
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Rowmoves origin words one two three four');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  expect((await read<{ title: string; status: string; labels: string[] }>(page, surface.path))).toMatchObject({ title: 'Rowmoves ticket by agent', status: 'todo', labels: ['x'] });
});

test('words typed and left before a slow refetch after a move answers still land (GF-79)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Slowread');
  await page.goto(surface.url);
  let slowReads = 2;
  await page.route(surface.path, async (route) => {
    if (route.request().method() === 'GET' && slowReads > 0) {
      slowReads -= 1;
      await new Promise((done) => setTimeout(done, 1500));
    }
    await route.continue();
  });

  await page.getByTestId('move-pick').click();
  await typeAtEnd(page, surface.testId, ' one');
  await leave(page);
  await expect.poll(() => stored(page, surface), { timeout: 10_000 }).toBe('Slowread origin words one');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

test('a save judged on words another writer has since replaced is still refused, and the field then says it moved (GF-79)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Overtakenfield');
  await page.goto(surface.url);
  await expect(doc(page, surface.testId)).toHaveText('Overtakenfield origin words');
  await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });

  const answered = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await typeAtEnd(page, surface.testId, ' mine');
  await leave(page);
  expect((await answered).status()).toBe(409);
  await expect(refusal(page, surface.testId)).toHaveText(MOVED);
  await expect(doc(page, surface.testId)).toHaveText('Overtakenfield origin words mine');
  expect(await stored(page, surface)).toBe('An agent rewrote this.');
});

async function keptThenMoved(page: Page, name: string) {
  const first = await SURFACES['a ticket description'](page, name);
  const second = await SURFACES['a ticket description'](page, `${name}beside`);
  await onFirstWithSecondAhead(page, first, second);
  const sent = patchesSent(page);
  let unreachable = true;
  await page.route(first.path, (route) => (isPatch(route) && unreachable ? route.abort() : route.continue()));
  await typeAtEnd(page, first.testId, ' kept');
  await leave(page);
  await expect(refusal(page, first.testId)).toHaveText(UNREACHED);
  await page.goForward();
  await expectTitle(page, second.title);
  unreachable = false;
  // as an agent, so history keeps its edit session apart from the person's (ADR-0008)
  await page.request.patch(first.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
  await page.goBack();
  await expectTitle(page, first.title);
  await expect(refusal(page, first.testId)).toHaveText(MOVED);
  await expect(doc(page, first.testId)).toHaveText(`${name} origin words kept`);
  return { first, second, sent };
}

test('a kept record whose field moved on the server sends nothing until you act, and your act then replaces it, in history too (GF-79)', async ({ page }) => {
  const { first, second, sent } = await keptThenMoved(page, 'Moved');
  const before = sent.length;

  await page.goForward();
  await expectTitle(page, second.title);
  await page.goBack();
  await expectTitle(page, first.title);
  await hideTab(page, true);
  await page.waitForTimeout(BEAT_MS);
  await hideTab(page, false);
  expect(sent.slice(before)).toEqual([]);
  expect(await stored(page, first)).toBe('An agent rewrote this.');
  await expect(refusal(page, first.testId)).toHaveText(MOVED);
  await expect(doc(page, first.testId)).toHaveText('Moved origin words kept');

  await typeAtEnd(page, first.testId, ' more');
  await leave(page);
  await expect.poll(() => stored(page, first)).toBe('Moved origin words kept more');
  await expect(refusal(page, first.testId)).toHaveCount(0);
  const [latest] = await read<{ kind: string; prior: Record<string, unknown>; new: Record<string, unknown> }[]>(page, `${first.path}/events`);
  expect(latest).toMatchObject({ kind: 'updated', prior: { description: 'An agent rewrote this.' }, new: { description: 'Moved origin words kept more' } });
});

test('⌘⏎ on a kept record whose field moved on the server saves the kept words over it (GF-79)', async ({ page }) => {
  const { first, sent } = await keptThenMoved(page, 'Kept');
  const before = sent.length;

  await doc(page, first.testId).click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('mode-line')).toHaveCount(0);
  await expect.poll(() => stored(page, first)).toBe('Kept origin words kept');
  await expect(refusal(page, first.testId)).toHaveCount(0);
  expect(sent.slice(before)).toEqual(['{"description":"Kept origin words kept"}']);
});

test('undo is not the act: undone back to the words the kept ones were based on, letting go takes the server’s (GF-79)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Undone');
  await page.goto(surface.url);
  const sent = patchesSent(page);
  let unreachable = true;
  await page.route(surface.path, (route) => (isPatch(route) && unreachable ? route.abort() : route.continue()));

  // two undo groups (TipTap closes one after 500 ms of quiet), both refused
  await typeAtEnd(page, surface.testId, ' kept');
  await page.waitForTimeout(BEAT_MS);
  await page.keyboard.type(' more');
  await leave(page);
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED);
  unreachable = false;
  await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
  // a window refocus refetches only once the cached body is past staleTime, so nudge until the read lands
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
      return (await refusal(page, surface.testId).count()) ? refusal(page, surface.testId).innerText() : null;
    })
    .toBe(MOVED);
  const before = sent.length;

  await doc(page, surface.testId).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(doc(page, surface.testId)).toHaveText('Undone origin words kept');
  await page.waitForTimeout(BEAT_MS);
  expect(sent.slice(before)).toEqual([]);
  await expect(refusal(page, surface.testId)).toHaveText(MOVED);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(doc(page, surface.testId)).toHaveText('Undone origin words');
  await leave(page);
  await expect(doc(page, surface.testId)).toHaveText('An agent rewrote this.');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  await page.waitForTimeout(BEAT_MS);
  expect(sent.slice(before)).toEqual([]);
  expect(await stored(page, surface)).toBe('An agent rewrote this.');
});

test('esc on a kept record whose field moved on the server drops the kept words for the server’s, sending nothing (GF-79)', async ({ page }) => {
  const { first, sent } = await keptThenMoved(page, 'Dropped');
  const before = sent.length;

  await doc(page, first.testId).click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await leave(page);
  await expect(doc(page, first.testId)).toHaveText('An agent rewrote this.');
  await expect(refusal(page, first.testId)).toHaveCount(0);
  await page.waitForTimeout(BEAT_MS);
  expect(sent.slice(before)).toEqual([]);
  expect(await stored(page, first)).toBe('An agent rewrote this.');
});

test('a 422 keeps the words in the field under the sentence that refused them (GF-79)', async ({ page }) => {
  const ticket = await post<Ticket>(page, '/api/tickets', { title: 'Too long' });
  await page.goto(`/tickets/${ticket.key}`);
  const field = doc(page, 'design');
  await field.click();
  await field.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, 'x'.repeat(200_001));
  await expect(refusal(page, 'design')).toHaveText('design: Too big: expected string to have <=200000 characters');
  expect((await field.innerText()).length).toBe(200_001);
  await leave(page);
  expect((await field.innerText()).length).toBe(200_001);
  expect((await read<{ design: string | null }>(page, `/api/tickets/${ticket.key}`)).design).toBeNull();
});

for (const [name, make] of Object.entries(SURFACES)) {
  test(`words flushed on leaving ${name} are there on a return before the write answers, and the next write carries them (GF-83)`, async ({ page }) => {
    const first = await make(page, `Flushedwords ${name.split(' ')[1]}`);
    const second = await make(page, `Afterwords ${name.split(' ')[1]}`);
    const origin = `${first.title.replace(/ \w+$/, '')} origin words`;
    await onFirstWithSecondAhead(page, first, second);
    await page.route(first.path, async (route) => {
      if (!isPatch(route)) return route.continue();
      await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });

    await typeAtEnd(page, first.testId, ' one');
    await page.goForward();
    await expectTitle(page, second.title);
    await page.goBack();
    await expectTitle(page, first.title);
    // read once, not retried: the write lands in 1500 ms and a refetch would then put the words there anyway
    expect(await doc(page, first.testId).innerText()).toBe(`${origin} one`);

    await typeAtEnd(page, first.testId, ' two');
    await leave(page);
    await expect.poll(() => stored(page, first), { timeout: 10_000 }).toBe(`${origin} one two`);
    await page.waitForTimeout(BEAT_MS);
    expect(await stored(page, first)).toBe(`${origin} one two`);
  });
}

test('words that landed while away are there on a return before the refetch answers (GF-83)', async ({ page }) => {
  const first = await SURFACES['a ticket description'](page, 'Landedwords');
  const second = await SURFACES['a ticket description'](page, 'Elsewherewords');
  await onFirstWithSecondAhead(page, first, second);

  const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok());
  await typeAtEnd(page, first.testId, ' one');
  await page.goForward();
  await expectTitle(page, second.title);
  await landed;
  // the return is served from the cache while this answers
  await page.route(first.path, async (route) => {
    await new Promise((done) => setTimeout(done, 3000));
    await route.continue();
  });
  await page.goBack();
  await expectTitle(page, first.title);
  expect(await doc(page, first.testId).innerText()).toBe('Landedwords origin words one');

  await typeAtEnd(page, first.testId, ' two');
  await leave(page);
  await expect.poll(() => stored(page, first), { timeout: 10_000 }).toBe('Landedwords origin words one two');
});

test('a second write waits for the first, so a slow first write cannot land over it (GF-83)', async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Orderedwords');
  await page.goto(surface.url);
  let patches = 0;
  await page.route(surface.path, async (route) => {
    if (!isPatch(route)) return route.continue();
    patches += 1;
    if (patches === 1) await new Promise((done) => setTimeout(done, 2500));
    await route.continue();
  });

  let answered = 0;
  page.on('response', (response) => {
    if (response.request().method() === 'PATCH') answered += 1;
  });
  await typeAtEnd(page, surface.testId, ' one');
  await leave(page);
  await typeAtEnd(page, surface.testId, ' two');
  await leave(page);
  // both writes have answered, the slow one included, before the server is read
  await expect.poll(() => answered, { timeout: 10_000 }).toBe(2);
  expect(patches).toBe(2);
  expect(await stored(page, surface)).toBe('Orderedwords origin words one two');
});

test("a rewrite that lands after your own save shows itself when the caret leaves (GF-83)", async ({ page }) => {
  const surface = await SURFACES['a ticket description'](page, 'Overtaken');
  await page.goto(surface.url);
  const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok());
  await typeAtEnd(page, surface.testId, ' mine');
  await landed;
  await expect.poll(() => stored(page, surface)).toBe('Overtaken origin words mine');

  await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' } });
  // past the query client's staleTime, so the refocus below refetches
  await page.waitForTimeout(BEAT_MS);
  // what a window refocus does: the query client refetches on it
  const refetched = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === surface.path);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refetched;
  await expect(doc(page, surface.testId)).toHaveText('Overtaken origin words mine');

  await leave(page);
  await expect(doc(page, surface.testId)).toHaveText('An agent rewrote this.');
  await page.waitForTimeout(BEAT_MS);
  expect(await stored(page, surface)).toBe('An agent rewrote this.');
});

test('a create the API never answers says so in a sentence on the board (GF-79)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.route('**/api/tickets', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await page.keyboard.press('c');
  const form = page.getByTestId('board-create');
  await form.getByLabel('ticket title').fill('Never made');
  await form.getByLabel('ticket title').press('ControlOrMeta+Enter');
  await expect(form.getByRole('alert')).toHaveText(UNREACHED);
});

async function ticketHolding(page: Page, name: string, description: string) {
  const ticket = await post<Ticket>(page, '/api/tickets', { title: `${name} ticket`, description });
  const surface: Surface = { title: ticket.title, url: `/tickets/${ticket.key}`, path: `/api/tickets/${ticket.key}`, column: 'description', testId: 'description' };
  await page.goto(surface.url);
  return surface;
}

async function helloWorld(page: Page, name: string) {
  const surface = await ticketHolding(page, name, 'hello world');
  await expect(doc(page, surface.testId)).toHaveText('hello world');
  return surface;
}

// past staleTime in web/src/main.tsx: a refocus refetches by then
const STALE_MS = 1_100;

async function refetchUnderTheCaret(page: Page, surface: Surface) {
  await page.waitForTimeout(STALE_MS);
  const refetched = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === surface.path);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refetched;
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function pasteAtTheCaret(page: Page, surface: Surface, text: string) {
  await twoFrames(page);
  await doc(page, surface.testId).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function pasteBeforeTheSpace(page: Page, surface: Surface, text: string) {
  await clickPastTheWords(page, doc(page, surface.testId));
  for (let i = 0; i < ' world'.length; i += 1) await page.keyboard.press('ArrowLeft');
  await pasteAtTheCaret(page, surface, text);
}

const aboutSaving = (page: Page) => page.getByTestId('about-tile').getByTestId('saving');
/** Well inside IDLE_MS, so a word still sticking from the last save has not yet given way to the write the idle beat sends. */
const BEFORE_THE_BEAT = { timeout: 300 };
const clickAway = (page: Page) => page.getByTestId('page-title').click();

for (const [pasted, settled, typed] of [
  ['1. ', 'hello\n\n1. \n\n world', 'hello\n\n1. \n\nQ world'],
  ['1. a', 'hello\n\n1. a\n\n world', 'hello\n\n1. a\n\nQ world'],
] as const) {
  test(`a letter typed after a pasted \`${pasted}\` is stored, the field says \`saved\` only once it is, and nobody is said to have moved it (GF-104)`, async ({ page }) => {
    const surface = await helloWorld(page, `Pasted ${pasted}`);
    const sent = patchesSent(page);
    await pasteBeforeTheSpace(page, surface, pasted);
    await expect.poll(() => stored(page, surface)).toBe(settled);
    await expect(aboutSaving(page)).toHaveText('saved');

    await page.keyboard.type('Q');
    await expect(aboutSaving(page)).toHaveText('saving…', BEFORE_THE_BEAT);
    await expect.poll(() => stored(page, surface)).toBe(typed);
    await expect(aboutSaving(page)).toHaveText('saved');

    await clickAway(page);
    await page.waitForTimeout(BEAT_MS);
    await expect(refusal(page, surface.testId)).toHaveCount(0);
    expect(sent).toEqual([JSON.stringify({ description: settled }), JSON.stringify({ description: typed })]);

    await page.reload();
    await expect(doc(page, surface.testId).locator('p').last()).toHaveText('Q world');
    expect(await stored(page, surface)).toBe(typed);
  });
}

test('undo after a settled paste of a list stores what the field then shows (GF-104)', async ({ page }) => {
  const surface = await helloWorld(page, 'Undone paste');
  const sent = patchesSent(page);
  await pasteBeforeTheSpace(page, surface, '1. ');
  await expect.poll(() => stored(page, surface)).toBe('hello\n\n1. \n\n world');
  await expect(aboutSaving(page)).toHaveText('saved');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(doc(page, surface.testId)).toHaveText('hello world');
  await expect.poll(() => stored(page, surface)).toBe('hello world');

  await clickAway(page);
  await page.waitForTimeout(BEAT_MS);
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  await page.reload();
  await expect(doc(page, surface.testId)).toHaveText('hello world');
  expect(sent).toEqual(['{"description":"hello\\n\\n1. \\n\\n world"}', '{"description":"hello world"}']);
});

/** A key that acts on the selection the editor has read, which a click reaches a frame later. */
const caretAtEndOf = async (page: Page, line: Locator) => {
  await clickPastTheWords(page, line);
  await twoFrames(page);
};

const wholeParagraph = async (page: Page, surface: Surface, words: string) => {
  await caretAtEndOf(page, doc(page, surface.testId).getByText(words, { exact: true }));
  for (let i = 0; i <= words.length; i += 1) await page.keyboard.press('Backspace');
};

const lineBelow = async (page: Page, line: Locator, words: string) => {
  await caretAtEndOf(page, line);
  await page.keyboard.press('Enter');
  await page.keyboard.type(words);
};

const THREE = 'aaa\n\nbbb\n\nccc';

/** One person and nobody else: every step they took comes back, in order, whatever the click away showed them. `stored` is the body before the first press and `steps` what each press stores. */
const ONE_PERSON: { edit: string; body: string; words: (page: Page, surface: Surface) => Promise<unknown>; stored: string; steps: string[] }[] = [
  {
    edit: 'a paragraph deleted, then a URL typed',
    body: THREE,
    words: async (page, surface) => {
      await wholeParagraph(page, surface, 'bbb');
      await expect.poll(() => stored(page, surface)).toBe('aaa\n\nccc');
      await typeAtEnd(page, surface.testId, ' see http://x.y', doc(page, surface.testId).getByText('ccc'));
    },
    stored: 'aaa\n\nccc see http://x.y',
    steps: ['aaa\n\nccc', THREE],
  },
  {
    edit: 'a paragraph deleted, then an email typed',
    body: THREE,
    words: async (page, surface) => {
      await wholeParagraph(page, surface, 'bbb');
      await expect.poll(() => stored(page, surface)).toBe('aaa\n\nccc');
      await typeAtEnd(page, surface.testId, ' mail x@y.z', doc(page, surface.testId).getByText('ccc'));
    },
    stored: 'aaa\n\nccc mail x@y.z',
    steps: ['aaa\n\nccc', THREE],
  },
  {
    edit: 'a paragraph deleted, then `1) step` typed on its own line',
    body: THREE,
    words: async (page, surface) => {
      await wholeParagraph(page, surface, 'bbb');
      await expect.poll(() => stored(page, surface)).toBe('aaa\n\nccc');
      await lineBelow(page, doc(page, surface.testId).getByText('ccc'), '1) step');
    },
    stored: 'aaa\n\nccc\n\n1) step',
    steps: ['aaa\n\nccc', THREE],
  },
  {
    edit: 'a pasted `1. a`',
    body: 'hello world',
    words: (page, surface) => pasteBeforeTheSpace(page, surface, '1. a'),
    stored: 'hello\n\n1. a\n\n world',
    steps: ['hello world'],
  },
  {
    edit: 'a pasted `1. `',
    body: 'hello world',
    words: (page, surface) => pasteBeforeTheSpace(page, surface, '1. '),
    stored: 'hello\n\n1. \n\n world',
    steps: ['hello world'],
  },
  {
    edit: 'a paragraph deleted, then words that read back as they are',
    body: THREE,
    words: async (page, surface) => {
      await wholeParagraph(page, surface, 'bbb');
      await expect.poll(() => stored(page, surface)).toBe('aaa\n\nccc');
      await typeAtEnd(page, surface.testId, ' more', doc(page, surface.testId).getByText('ccc'));
    },
    stored: 'aaa\n\nccc more',
    steps: ['aaa\n\nccc', THREE],
  },
  {
    edit: 'a URL typed, a click away, then `1) step` typed',
    body: THREE,
    words: async (page, surface) => {
      await typeAtEnd(page, surface.testId, ' see http://x.y', doc(page, surface.testId).getByText('ccc'));
      await expect.poll(() => stored(page, surface)).toBe('aaa\n\nbbb\n\nccc see http://x.y');
      await clickAway(page);
      await expect(doc(page, surface.testId).locator('a')).toHaveText('http://x.y');
      await lineBelow(page, doc(page, surface.testId).getByText('ccc see'), '1) step');
    },
    stored: 'aaa\n\nbbb\n\nccc see [http://x.y](http://x.y)\n\n1) step',
    steps: ['aaa\n\nbbb\n\nccc see [http://x.y](http://x.y)', THREE],
  },
];

for (const { edit, body, words, stored: held, steps } of ONE_PERSON) {
  for (const blurs of [false, true]) {
    test(`one person, nobody else: after ${edit} and a click away, ${blurs ? 'undo with a click away between presses' : 'undo'} brings back each step and sends nothing twice (GF-105)`, async ({ page }) => {
      const surface = await ticketHolding(page, `Undone ${edit} ${blurs}`, body);
      const firstWords = doc(page, surface.testId).locator('p').first();
      await expect(firstWords).toBeVisible();
      const sent = patchesSent(page);
      await words(page, surface);
      await expect.poll(() => stored(page, surface)).toBe(held);
      await clickAway(page);
      await expect(page.getByTestId('mode-line')).toHaveCount(0);
      await page.waitForTimeout(BEAT_MS);
      await expect(refusal(page, surface.testId)).toHaveCount(0);

      await firstWords.click();
      await expect(page.getByTestId('mode-line')).toBeVisible();
      for (const step of steps) {
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(() => stored(page, surface)).toBe(step);
        if (!blurs) continue;
        await clickAway(page);
        await expect(page.getByTestId('mode-line')).toHaveCount(0);
        await page.waitForTimeout(BEAT_MS);
        await firstWords.click();
        await expect(page.getByTestId('mode-line')).toBeVisible();
      }
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(BEAT_MS);
      expect(await stored(page, surface)).toBe(steps.at(-1));
      expect(sent.filter((write, i) => write === sent[i - 1])).toEqual([]);
      await expect(refusal(page, surface.testId)).toHaveCount(0);
    });
  }
}

test('words on their way when the field was left are read in on the way back, so landing swaps nothing and undo has nothing to send (GF-105)', async ({ page }) => {
  const first = await SURFACES['a ticket description'](page, 'Back on its way');
  const second = await SURFACES['a ticket description'](page, 'Back on its way second');
  await onFirstWithSecondAhead(page, first, second);
  await slowPatches(page, first.path, LINK_MS * 3);
  const sent = patchesSent(page);

  await typeAtEnd(page, first.testId, ' see http://x.y');
  await page.goForward();
  await expectTitle(page, second.title);
  await page.goBack();
  await expectTitle(page, first.title);
  await expect(doc(page, first.testId).locator('a')).toHaveText('http://x.y');
  const held = 'Back on its way origin words see http://x.y';
  await expect.poll(() => stored(page, first)).toBe(held);
  await page.waitForTimeout(BEAT_MS);
  expect(await doc(page, first.testId).evaluate((element) => (element as TiptapEditorHTMLElement).editor?.can().undo())).toBe(false);

  await doc(page, first.testId).click({ position: { x: 1, y: 1 } });
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(BEAT_MS);
  await expect(doc(page, first.testId).locator('a')).toHaveText('http://x.y');
  expect(sent).toEqual([JSON.stringify({ description: held })]);
  expect(await stored(page, first)).toBe(held);
});

/** An agent's words came in over what the person did: nothing on the undo stack is about them, so no press writes over them. */
const OVER_AN_AGENT: { edit: string; words: (page: Page, surface: Surface) => Promise<unknown>; stored: string }[] = [
  {
    edit: 'a click away from words typed at the end',
    words: (page, surface) => typeAtEnd(page, surface.testId, ' Q', doc(page, surface.testId).getByText('mine two')),
    stored: 'mine one\n\nmine two Q',
  },
  {
    edit: 'a paragraph deleted',
    words: (page, surface) => wholeParagraph(page, surface, 'mine one'),
    stored: 'mine two',
  },
  {
    edit: 'everything deleted',
    words: async (page, surface) => {
      await doc(page, surface.testId).click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
    },
    stored: '',
  },
  {
    edit: 'everything typed over',
    words: async (page, surface) => {
      await doc(page, surface.testId).click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('X');
    },
    stored: 'X',
  },
  {
    edit: 'everything pasted over',
    words: async (page, surface) => {
      await doc(page, surface.testId).click();
      await page.keyboard.press('ControlOrMeta+a');
      await pasteAtTheCaret(page, surface, 'pasted one\n\npasted two');
    },
    stored: 'pasted one\n\npasted two',
  },
];

for (const { edit, words, stored: held } of OVER_AN_AGENT) {
  test(`after ${edit}, then an agent’s words, undo and redo do not put the person’s back over them (GF-105)`, async ({ page }) => {
    const surface = await ticketHolding(page, `Over an agent ${edit}`, 'mine one\n\nmine two');
    await expect(doc(page, surface.testId).getByText('mine two')).toBeVisible();
    await words(page, surface);
    await expect.poll(() => stored(page, surface)).toBe(held);
    await clickAway(page);
    await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
    await refetchUnderTheCaret(page, surface);
    await expect(doc(page, surface.testId)).toHaveText('An agent rewrote this.');
    const sent = patchesSent(page);

    await doc(page, surface.testId).click();
    await expect(page.getByTestId('mode-line')).toBeVisible();
    for (const key of ['ControlOrMeta+z', 'ControlOrMeta+z', 'ControlOrMeta+Shift+z']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(BEAT_MS);
      await expect(doc(page, surface.testId)).toHaveText('An agent rewrote this.');
    }
    expect(sent).toEqual([]);
    expect(await stored(page, surface)).toBe('An agent rewrote this.');
  });
}

test('words typed after an agent’s come off with one undo, and the next press leaves the agent’s where they are (GF-105)', async ({ page }) => {
  const surface = await helloWorld(page, 'After an agent');
  await typeAtEnd(page, surface.testId, ' BEFORE');
  await expect.poll(() => stored(page, surface)).toBe('hello world BEFORE');
  await clickAway(page);
  await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
  await refetchUnderTheCaret(page, surface);
  await expect(doc(page, surface.testId)).toHaveText('An agent rewrote this.');

  await typeAtEnd(page, surface.testId, ' AFTER');
  await expect.poll(() => stored(page, surface)).toBe('An agent rewrote this. AFTER');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => stored(page, surface)).toBe('An agent rewrote this.');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(BEAT_MS);
  expect(await stored(page, surface)).toBe('An agent rewrote this.');
  await expect(doc(page, surface.testId)).toHaveText('An agent rewrote this.');
});

test('letting go of a write that reads back differently shows what a reload shows, and writes nothing (GF-104)', async ({ page }) => {
  const surface = await helloWorld(page, 'Reads back');
  const sent = patchesSent(page);
  await pasteBeforeTheSpace(page, surface, '1. ');
  await expect.poll(() => stored(page, surface)).toBe('hello\n\n1. \n\n world');

  await clickAway(page);
  await expect(doc(page, surface.testId).locator('ol li')).toHaveText('world');
  await page.waitForTimeout(BEAT_MS);
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  expect(sent).toEqual(['{"description":"hello\\n\\n1. \\n\\n world"}']);
  expect(await stored(page, surface)).toBe('hello\n\n1. \n\n world');

  await typeAtEnd(page, surface.testId, 'Q', doc(page, surface.testId).locator('ol li'));
  await expect.poll(() => stored(page, surface)).toBe('hello\n\n1. worldQ');
});

test('placing the caret in a stored body that reads back differently writes nothing, and a letter typed there lands (GF-43, GF-104)', async ({ page }) => {
  const surface = await ticketHolding(page, 'Stored unstable', 'hello\n\n1. \n\n world');
  await expect(doc(page, surface.testId).locator('ol li')).toHaveText('world');
  const sent = patchesSent(page);

  await doc(page, surface.testId).click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.waitForTimeout(BEAT_MS);
  await clickAway(page);
  await expect(page.getByTestId('mode-line')).toHaveCount(0);
  await page.waitForTimeout(BEAT_MS);
  expect(sent).toEqual([]);
  expect(await stored(page, surface)).toBe('hello\n\n1. \n\n world');

  await typeAtEnd(page, surface.testId, 'Q', doc(page, surface.testId).locator('ol li'));
  await expect.poll(() => stored(page, surface)).toBe('hello\n\n1. worldQ');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

for (const body of ['# ', '> > ', '1. \n\n# ', '> a\n\n# ', '# \n\n- a', '> \n\n- a\n- b', '* ```\nc\n```']) {
  test(`placing the caret in a stored ${JSON.stringify(body)}, and an undo with nothing to undo, write nothing (GF-43, GF-105)`, async ({ page }) => {
    const surface = await ticketHolding(page, `Bare ${JSON.stringify(body)}`, body);
    await expect(doc(page, surface.testId)).toBeVisible();
    const sent = patchesSent(page);

    await doc(page, surface.testId).click();
    await expect(page.getByTestId('mode-line')).toBeVisible();
    await page.waitForTimeout(BEAT_MS);
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(BEAT_MS);
    await clickAway(page);
    await expect(page.getByTestId('mode-line')).toHaveCount(0);
    await page.waitForTimeout(BEAT_MS);
    expect(sent).toEqual([]);
    expect(await stored(page, surface)).toBe(body);
    await expect(refusal(page, surface.testId)).toHaveCount(0);
  });
}

test('a letter typed in a stored bare marker lands (GF-105)', async ({ page }) => {
  const surface = await ticketHolding(page, 'Bare typed', '# ');
  await doc(page, surface.testId).click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.keyboard.type('Q');
  await expect.poll(() => stored(page, surface)).toBe('# Q');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

test('a refused save after a pasted list keeps its words and says so, and the next act sends them (GF-79, GF-104)', async ({ page }) => {
  const surface = await helloWorld(page, 'Refused paste');
  await pasteBeforeTheSpace(page, surface, '1. ');
  await expect.poll(() => stored(page, surface)).toBe('hello\n\n1. \n\n world');
  await expect(aboutSaving(page)).toHaveText('saved');

  let unreachable = true;
  await page.route(surface.path, (route) => (isPatch(route) && unreachable ? route.abort() : route.continue()));
  await page.keyboard.type('Q');
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED);
  await expect(aboutSaving(page)).toHaveCount(0);
  await expect(doc(page, surface.testId).locator('p').last()).toHaveText('Q world');
  expect(await stored(page, surface)).toBe('hello\n\n1. \n\n world');

  unreachable = false;
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('hello\n\n1. \n\nQ world');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

test('`saved` gives way to `saving…` at the first key after a save, until the words land, on a plain body too (GF-104)', async ({ page }) => {
  const surface = await helloWorld(page, 'Sticky word');
  await typeAtEnd(page, surface.testId, ' one');
  await expect(aboutSaving(page)).toHaveText('saved');
  expect(await stored(page, surface)).toBe('hello world one');

  await page.keyboard.type(' two');
  await expect(aboutSaving(page)).toHaveText('saving…', BEFORE_THE_BEAT);
  await expect(page.getByTestId('saving-line')).toHaveText('saving…', BEFORE_THE_BEAT);
  await expect(aboutSaving(page)).toHaveText('saved');
  expect(await stored(page, surface)).toBe('hello world one two');
});

test('letters typed under a real rewrite, held until the caret leaves, are never called saved (GF-104)', async ({ page }) => {
  const surface = await helloWorld(page, 'Held word');
  await typeAtEnd(page, surface.testId, ' one');
  await expect(aboutSaving(page)).toHaveText('saved');

  await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
  await refetchUnderTheCaret(page, surface);
  await expect(aboutSaving(page)).toHaveCount(0);

  await page.keyboard.type(' two');
  await page.waitForTimeout(BEAT_MS);
  await expect(aboutSaving(page)).toHaveCount(0);
  expect(await stored(page, surface)).toBe('An agent rewrote this.');

  await clickAway(page);
  await expect(refusal(page, surface.testId)).toHaveText(MOVED);
  await expect(aboutSaving(page)).toHaveCount(0);
  await expect(doc(page, surface.testId)).toHaveText('hello world one two');

  await doc(page, surface.testId).click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => stored(page, surface)).toBe('hello world one two');
  await expect(aboutSaving(page)).toHaveText('saved');
});

test('letters held back by a rewrite go out once the rewrite is put back, with no second act (GF-104)', async ({ page }) => {
  const surface = await helloWorld(page, 'Put back');
  await typeAtEnd(page, surface.testId, ' one');
  await expect(aboutSaving(page)).toHaveText('saved');

  await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
  await refetchUnderTheCaret(page, surface);
  await page.keyboard.type(' two');
  await page.waitForTimeout(BEAT_MS);
  expect(await stored(page, surface)).toBe('An agent rewrote this.');

  await page.request.patch(surface.path, { data: { description: 'hello world one' }, headers: { 'x-goblin-actor': 'agent' } });
  await refetchUnderTheCaret(page, surface);
  await expect.poll(() => stored(page, surface)).toBe('hello world one two');
  await expect(aboutSaving(page)).toHaveText('saved');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
});

test('a save given up on and undone says nothing, because nothing is on its way (GF-104)', async ({ page }) => {
  test.setTimeout(BOUND_MS + 30_000);
  const surface = await helloWorld(page, 'Undone hung');
  await hangFirstPatch(page, surface.path);
  await typeAtEnd(page, surface.testId, ' one');
  await expect(refusal(page, surface.testId)).toHaveText(UNREACHED, { timeout: BOUND_MS + 5_000 });

  await page.keyboard.press('ControlOrMeta+z');
  await expect(doc(page, surface.testId)).toHaveText('hello world');
  await page.waitForTimeout(BEAT_MS);
  await expect(refusal(page, surface.testId)).toHaveCount(0);
  await expect(aboutSaving(page)).toHaveCount(0);
  expect(await stored(page, surface)).toBe('hello world');
});

for (const [kind, named] of [['app', 'an app'], ['project', 'a project']] as const) {
  const onDescribed = async (page: Page, name: string): Promise<Surface> => {
    const entity = await post<Named>(page, `/api/${kind}s`, { name: `${name} ${kind}`, description: 'hello world' });
    const surface: Surface = { title: entity.name, url: `/${kind}s/${entity.id}`, path: `/api/${kind}s/${entity.id}`, column: 'description', testId: `${kind}-description` };
    await page.goto(surface.url);
    await expect(doc(page, surface.testId)).toHaveText('hello world');
    return surface;
  };
  const openEditForm = async (page: Page) => {
    await page.getByRole('button', { name: `edit ${kind}` }).click();
    await expect(page.getByTestId('edit-form')).toBeVisible();
  };

  test(`with the \`edit\` form of ${named} open, the word says what the description's write is doing (GF-104)`, async ({ page }) => {
    const surface = await onDescribed(page, 'Edit form');
    await slowPatches(page, surface.path, BEAT_MS);
    await typeAtEnd(page, surface.testId, ' one');
    await openEditForm(page);
    await expect(aboutSaving(page)).toHaveText('saving…');

    await expect.poll(() => stored(page, surface)).toBe('hello world one');
    await expect(aboutSaving(page)).toHaveText('saved');
  });

  test(`the \`edit\` form of ${named} saves on submit, and the word claims nothing of it (GF-104)`, async ({ page }) => {
    await onDescribed(page, 'Edit form submit');
    await openEditForm(page);
    await expect(aboutSaving(page)).toHaveCount(0);

    const nameField = page.getByTestId('edit-form').getByLabel('name', { exact: true });
    await nameField.fill('Edit form submitted');
    await nameField.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('edit-form')).toHaveCount(0);
    await expect(page.getByTestId('page-title')).toHaveText('Edit form submitted');
    await expect(aboutSaving(page)).toHaveCount(0);
  });

  test(`with the \`edit\` form of ${named} open, a refused write leaves no word, and closing the form brings its sentence back (GF-104)`, async ({ page }) => {
    const surface = await onDescribed(page, 'Edit form refused');
    await page.route(surface.path, (route) => (isPatch(route) ? route.abort() : route.continue()));
    await typeAtEnd(page, surface.testId, ' one');
    await openEditForm(page);
    await expect(aboutSaving(page)).toHaveCount(0);

    await page.getByTestId('edit-form').getByRole('button', { name: 'cancel' }).click();
    await expect(refusal(page, surface.testId)).toHaveText(UNREACHED);
    await expect(aboutSaving(page)).toHaveCount(0);
    await expect(doc(page, surface.testId)).toHaveText('hello world one');
  });

  test(`with the \`edit\` form of ${named} open, words stopped by a body that moved are not called \`saved\` (GF-104)`, async ({ page }) => {
    const surface = await onDescribed(page, 'Edit form moved');
    await typeAtEnd(page, surface.testId, ' one');
    await expect(aboutSaving(page)).toHaveText('saved');

    await page.request.patch(surface.path, { data: { description: 'An agent rewrote this.' }, headers: { 'x-goblin-actor': 'agent' } });
    await refetchUnderTheCaret(page, surface);
    await page.keyboard.type(' two');
    await openEditForm(page);
    await page.waitForTimeout(BEAT_MS);
    await expect(aboutSaving(page)).toHaveCount(0);

    await page.getByTestId('edit-form').getByRole('button', { name: 'cancel' }).click();
    await expect(refusal(page, surface.testId)).toHaveText(MOVED);
    await expect(aboutSaving(page)).toHaveCount(0);
    expect(await stored(page, surface)).toBe('An agent rewrote this.');
  });
}
