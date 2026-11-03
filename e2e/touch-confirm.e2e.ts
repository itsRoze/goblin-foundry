import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * The one question the tracker asks, answered by finger: the control whose tap asked it is never
 * where the answer is drawn, so a second tap on the same spot, however fast, writes nothing (GF-44).
 * A bare finger gets the board's column question only from a drop; with a keyboard beside it, `j s`
 * opens the palette and the tap on its row asks.
 */

type Ticket = { key: string };
type Box = { x: number; y: number; width: number; height: number };

const mine = (title: string) => `${test.info().project.name} ${title}`;
const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;
const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; trashed_at: string | null };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** A rect in page coordinates, so a control measured before a scroll and an answer measured after it share a frame. */
async function pageBox(locator: Locator): Promise<Box> {
  const box = (await locator.boundingBox())!;
  const { x, y } = await locator.page().evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  return { ...box, x: box.x + x, y: box.y + y };
}

let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: `Tap ${Date.now().toString(36)}` } });
  appId = ((await response.json()) as { id: number }).id;
});

async function blocked(page: Page, title: string) {
  const blocker = await post<Ticket>(page, '/api/tickets', { title: mine('Holdup'), app_id: appId, simple: true });
  const t = await post<Ticket>(page, '/api/tickets', { title, status: 'ready', app_id: appId, simple: true });
  await page.request.post(`/api/tickets/${t.key}/dependencies`, { data: { blocker: blocker.key } });
  return t.key;
}

const wrote = (page: Page, keys: string[]) => async () => {
  for (const key of keys) {
    const t = await read(page, key);
    if (t.status !== 'ready' || t.trashed_at !== null) return true;
  }
  return false;
};

type Armed = { control: Locator; answer: Locator; wrote: () => Promise<boolean> };

async function board(page: Page, q: string, key: string) {
  await page.goto(`/?q=${encodeURIComponent(q)}`);
  await expect(page.getByTestId(`card-${key}`)).toBeVisible();
}

async function selectedPair(page: Page, title: string) {
  const held = await blocked(page, `${title} held`);
  const free = (await post<Ticket>(page, '/api/tickets', { title: `${title} free`, status: 'ready', app_id: appId, simple: true })).key;
  await board(page, title, held);
  await page.getByTestId(`select-${held}`).tap();
  await page.getByTestId(`select-${free}`).tap();
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  return [held, free];
}

const SURFACES: Record<string, (page: Page, title: string) => Promise<Armed>> = {
  'the Ticket view': async (page, title) => {
    const key = await blocked(page, title);
    await page.goto(`/tickets/${key}`);
    await expect(page.getByTestId('move-start')).toBeVisible();
    return { control: page.getByTestId('move-start'), answer: page.getByTestId('confirm-start-yes'), wrote: wrote(page, [key]) };
  },
  'a board column': async (page, title) => {
    const key = await blocked(page, title);
    await board(page, title, key);
    await page.keyboard.press('j');
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('confirm-ready-yes'), wrote: wrote(page, [key]) };
  },
  'a card': async (page, title) => {
    const key = await blocked(page, title);
    await board(page, title, key);
    await page.getByTestId(`menu-${key}`).tap();
    await expect(page.getByTestId(`menu-${key}-start`)).toBeVisible();
    return { control: page.getByTestId(`menu-${key}-start`), answer: page.getByTestId('confirm-ready-yes'), wrote: wrote(page, [key]) };
  },
  'a bulk start': async (page, title) => {
    const keys = await selectedPair(page, title);
    await page.getByTestId('bulk-status').tap();
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('bulk-confirm-yes'), wrote: wrote(page, keys) };
  },
  'a bulk trash': async (page, title) => {
    const keys = await selectedPair(page, title);
    return { control: page.getByTestId('bulk-trash'), answer: page.getByTestId('bulk-confirm-yes'), wrote: wrote(page, keys) };
  },
};

const WIDTHS = [390, 430, 768, 1024, 1366];
const TAP_GAPS = [80, 200, 350, 600];

for (const width of WIDTHS)
  for (const [surface, arm] of Object.entries(SURFACES))
    test(`on ${surface} at ${width}px the answer is not under the tapped control, and a double tap on that spot writes nothing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const tag = mine(`Tap${width}${surface.replace(/\W/g, '')}`);
      const { control, answer } = await arm(page, `${tag} rect`);
      const spot = await pageBox(control);
      await control.tap();
      await expect(answer).toBeVisible();
      const drawn = await pageBox(answer);
      expect(overlaps(spot, drawn), `control ${JSON.stringify(spot)} answer ${JSON.stringify(drawn)}`).toBe(false);

      for (const gap of TAP_GAPS) {
        const armed = await arm(page, `${tag} gap${gap}`);
        await armed.control.scrollIntoViewIfNeeded();
        const box = (await armed.control.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.touchscreen.tap(x, y);
        expect(await armed.answer.count(), `gap ${gap}: the first tap asked`).toBe(1);
        await page.waitForTimeout(gap);
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(400);
        expect(await armed.wrote(), `gap ${gap}`).toBe(false);
      }
    });

test('a tap on start or trash opens the question on cancel, ⇧Tab reaches the answer in this engine too and ⏎ there writes, Tab comes back to cancel', async ({ page }) => {
  const key = await blocked(page, mine('Tabbed start'));
  await page.goto(`/tickets/${key}`);
  await page.getByTestId('move-start').tap();
  await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('confirm-start-yes')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  expect((await read(page, key)).status).toBe('ready');
  await page.getByTestId('move-start').tap();
  await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('state-tile')).toContainText('building');
  expect((await read(page, key)).status).toBe('building');

  const keys = await selectedPair(page, mine('Tabbed trash'));
  await page.getByTestId('bulk-trash').tap();
  await expect(page.getByTestId('bulk-confirm-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('bulk-confirm-yes')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('bulk-confirm-cancel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);
  expect(await wrote(page, keys)()).toBe(false);
});

async function wrappedTicket(page: Page, title: string) {
  const key = await blocked(page, title);
  let last = '';
  for (const n of [2, 3]) {
    const blocker = await post<Ticket>(page, '/api/tickets', { title: mine(`Holdup ${n}`), app_id: appId, simple: true });
    await page.request.post(`/api/tickets/${key}/dependencies`, { data: { blocker: blocker.key } });
    last = blocker.key;
  }
  await page.goto(`/tickets/${key}`);
  await expect(page.getByTestId('state-blocked')).toContainText(last);
  return key;
}

/** `start` tapped with its foot this many pixels above the fold: at 0 the line opens entirely below it. */
const FOOT_GAPS = [0, 15, 30, 45, 60, 75, 90, 105];

for (const footGap of FOOT_GAPS)
  test(`at 390 with a wrapped sentence and start ${footGap}px above the fold, the answer does not land where start was, and a second tap there writes nothing`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const key = await wrappedTicket(page, mine(`Sweep${footGap}`));
    const start = page.getByTestId('move-start');
    await start.scrollIntoViewIfNeeded();
    const atRest = (await start.boundingBox())!;
    await page.evaluate((by) => window.scrollBy(0, by), atRest.y + atRest.height - (844 - footGap));
    const spot = (await start.boundingBox())!;
    expect(Math.abs(spot.y + spot.height - (844 - footGap)), 'start sits where the sweep put it').toBeLessThanOrEqual(1);
    const x = spot.x + spot.width / 2;
    const y = spot.y + spot.height / 2;
    await page.touchscreen.tap(x, y);
    const answer = page.getByTestId('confirm-start-yes');
    expect(await answer.count(), 'the tap asked').toBe(1);
    await page.waitForTimeout(200);
    const drawn = (await answer.boundingBox())!;
    expect(overlaps(spot, drawn), `start ${JSON.stringify(spot)} answer ${JSON.stringify(drawn)}`).toBe(false);
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(400);
    expect((await read(page, key)).status).toBe('ready');
  });

const LONG_DESCRIPTION = Array.from({ length: 60 }, (_, n) => `Paragraph ${n} of a long description.`).join('\n\n');
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
async function tap(page: Page, control: Locator) {
  const box = (await control.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Scrolls until the top of `control` sits this many pixels above the viewport, and says where the page rests. */
async function clipTop(control: Locator, by: number) {
  const page = control.page();
  await page.evaluate((down) => window.scrollBy(0, down), (await control.boundingBox())!.y + by);
  expect(Math.abs((await control.boundingBox())!.y + by), 'the control sits where the sweep put it').toBeLessThanOrEqual(1);
  return scrollY(page);
}

async function longBlocked(page: Page, name: string) {
  await page.setViewportSize({ width: 1366, height: 768 });
  const key = await blocked(page, mine(name));
  await page.request.patch(`/api/tickets/${key}`, { data: { description: LONG_DESCRIPTION } });
  await page.goto(`/tickets/${key}`);
  await expect(page.getByTestId('state-tile')).toBeVisible();
  return key;
}

for (const by of [3, 29, 40]) {
  async function askedWithStartClipped(page: Page, name: string) {
    const key = await longBlocked(page, `${name}${by}`);
    await page.getByTestId('move-start').tap();
    await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();
    return { key, rest: await clipTop(page.getByTestId('move-start'), by) };
  }

  test(`with start ${by}px above the top at 1366, a tap on cancel leaves the page where it is and the focus on start`, async ({ page }) => {
    const { rest } = await askedWithStartClipped(page, 'StayCancel');
    await tap(page, page.getByTestId('confirm-start-cancel'));
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
    await expect(page.getByTestId('move-start')).toBeFocused();
    expect(await scrollY(page)).toBe(rest);
  });

  test(`with start ${by}px above the top at 1366, a tap on start anyway leaves the page where it is and writes`, async ({ page }) => {
    const { key, rest } = await askedWithStartClipped(page, 'StayYes');
    await tap(page, page.getByTestId('confirm-start-yes'));
    await expect(page.getByTestId('state-tile')).toContainText('building');
    expect((await read(page, key)).status).toBe('building');
    expect(await scrollY(page)).toBe(rest);
  });

  test(`with + add ${by}px above the top at 1366, a tap on a candidate leaves the page where it is and the focus on + add`, async ({ page }) => {
    const spare = (await post<Ticket>(page, '/api/tickets', { title: mine(`StayPick${by} spare`), app_id: appId, simple: true })).key;
    await longBlocked(page, `StayPick${by}`);
    await page.getByTestId('add-depends_on').tap();
    await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill(spare);
    await expect(page.getByTestId(`pick-${spare}`)).toBeVisible();
    const rest = await clipTop(page.getByTestId('add-depends_on'), by);
    await tap(page, page.getByTestId(`pick-${spare}`));
    await expect(page.getByTestId('deps-depends_on')).toContainText(spare);
    await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
    await expect(page.getByTestId('add-depends_on')).toBeFocused();
    expect(await scrollY(page)).toBe(rest);
  });
}
