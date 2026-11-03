import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

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

async function typeAtEnd(page: Page, testId: string, words: string) {
  await doc(page, testId).click();
  await expect(page.getByTestId('mode-line')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+End');
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

test('a save given up on cannot land over a later one: the API refuses it on the version it was judged on (GF-79)', async ({ page }) => {
  test.setTimeout(BOUND_MS + 30_000);
  const surface = await SURFACES['a ticket description'](page, 'Late');
  const key = surface.path.split('/').at(-1);
  const judgedAt = (await read<{ updated_at: string }>(page, surface.path)).updated_at;
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

  const headers = await request.allHeaders();
  expect(headers['x-goblin-updated-at']).toBe(judgedAt);
  const late = await page.request.patch(surface.path, { data: request.postData() ?? '', headers: { 'content-type': 'application/json', 'x-goblin-updated-at': judgedAt } });
  expect([late.status(), (await late.json()).hint]).toEqual([409, `nothing changed — ticket ${key} changed while the edit was being applied; try again`]);
  expect(await stored(page, surface)).toBe('Late origin words one two');
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
