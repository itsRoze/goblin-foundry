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

// past IDLE_MS in web/src/editor.tsx: a write the editor means to send has gone out by then
const BEAT_MS = 1000;

const doc = (page: Page, testId: string) => page.getByTestId(testId).locator('.gf-doc');
const refusal = (page: Page, testId: string) => page.getByTestId(testId).getByRole('alert');

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

test('a 409 on the blur save keeps the words over what the other writer put there (GF-79)', async ({ page }) => {
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
  await expect(refusal(page, surface.testId)).toHaveText(hint);

  await doc(page, surface.testId).click();
  await leave(page);
  await expect.poll(() => stored(page, surface)).toBe('Conflicted origin words mine');
  await expect(refusal(page, surface.testId)).toHaveCount(0);
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
