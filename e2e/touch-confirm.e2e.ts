import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * The one question the tracker asks, answered by finger: the control whose tap asked it is never
 * where the answer is drawn, so a second tap on the same spot, however fast, writes nothing (GF-44).
 * The board's column question is left out, because no tap asks it: a finger gets it from a drop.
 */

type Ticket = { key: string };
type Box = { x: number; y: number; width: number; height: number };

const mine = (title: string) => `${test.info().project.name} ${title}`;
const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;
const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; trashed_at: string | null };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: `Touch confirm ${Math.random()}` } });
  appId = ((await response.json()) as { id: number }).id;
});

async function blocked(page: Page, title: string) {
  const blocker = await post<Ticket>(page, '/api/tickets', { title: mine('Holdup'), app_id: appId, simple: true });
  const t = await post<Ticket>(page, '/api/tickets', { title, status: 'ready', app_id: appId, simple: true });
  await page.request.post(`/api/tickets/${t.key}/dependencies`, { data: { blocker: blocker.key } });
  return t.key;
}

const unchanged = (page: Page, keys: string[]) => async () => {
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

async function pair(page: Page, title: string) {
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
    return { control: page.getByTestId('move-start'), answer: page.getByTestId('confirm-start-yes'), wrote: unchanged(page, [key]) };
  },
  'a card': async (page, title) => {
    const key = await blocked(page, title);
    await board(page, title, key);
    await page.getByTestId(`menu-${key}`).tap();
    await expect(page.getByTestId(`menu-${key}-start`)).toBeVisible();
    return { control: page.getByTestId(`menu-${key}-start`), answer: page.getByTestId('confirm-ready-yes'), wrote: unchanged(page, [key]) };
  },
  'a bulk start': async (page, title) => {
    const keys = await pair(page, title);
    await page.getByTestId('bulk-status').tap();
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('bulk-confirm-yes'), wrote: unchanged(page, keys) };
  },
  'a bulk trash': async (page, title) => {
    const keys = await pair(page, title);
    return { control: page.getByTestId('bulk-trash'), answer: page.getByTestId('bulk-confirm-yes'), wrote: unchanged(page, keys) };
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
      const spot = (await control.boundingBox())!;
      await control.tap();
      await expect(answer).toBeVisible();
      const drawn = (await answer.boundingBox())!;
      expect(overlaps(spot, drawn), `control ${JSON.stringify(spot)} answer ${JSON.stringify(drawn)}`).toBe(false);

      for (const gap of TAP_GAPS) {
        const armed = await arm(page, `${tag} gap${gap}`);
        const box = (await armed.control.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(gap);
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(400);
        expect(await armed.wrote(), `gap ${gap}`).toBe(false);
      }
    });

// the touch projects are the suite's only WebKit, whose Tab skips a button unless it carries a `tabindex` or full keyboard access is on
test('a tap on start opens the question on cancel, and ⇧Tab reaches the answer in this engine too', async ({ page }) => {
  const key = await blocked(page, mine('Tabbed start'));
  await page.goto(`/tickets/${key}`);
  await page.getByTestId('move-start').tap();
  await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('confirm-start-yes')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  expect((await read(page, key)).status).toBe('ready');
});
