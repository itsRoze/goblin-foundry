import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Named to run late: the earlier specs count tickets and address keys by name. */

const BELOW_THE_FOLD = { width: 500, height: 723 };

type Ticket = { key: string };

const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;
const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; trashed_at: string | null };

let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: `Ask ${Date.now().toString(36)}` } });
  appId = ((await response.json()) as { id: number }).id;
});

async function blockedTicket(page: Page, name: string, fields: object = {}) {
  const blocker = await post<Ticket>(page, '/api/tickets', { title: 'Holdup' });
  const blocked = await post<Ticket>(page, '/api/tickets', { title: `${name} blocked`, status: 'ready', app_id: appId, simple: true, ...fields });
  await page.request.post(`/api/tickets/${blocked.key}/dependencies`, { data: { blocker: blocker.key } });
  await page.goto(`/tickets/${blocked.key}`);
  await expect(page.getByTestId('state-tile')).toBeVisible();
  return { ...blocked, app: appId };
}

async function askByKey(page: Page) {
  await page.keyboard.press('s');
  await expect(page.getByTestId('run-move-start')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
}

async function twice(page: Page, key: string, gapMs: number) {
  await page.keyboard.press(key);
  await page.waitForTimeout(gapMs);
  await page.keyboard.press(key);
  await page.waitForTimeout(400);
}

const GAPS = [30, 100, 400];

test('s ⏎ on a blocked Ticket puts the question on screen with the focus on leave it, so ⏎ dismisses it and ⇧Tab ⏎ answers it (GF-44, GF-84)', async ({ page }) => {
  await page.setViewportSize(BELOW_THE_FOLD);
  const blocked = await blockedTicket(page, 'Askfocus');
  await askByKey(page);
  await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();
  await expect(page.getByTestId('confirm-start-dismiss')).toBeInViewport();
  await expect(page.getByTestId('state-tile')).toHaveClass(/is-focus/);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('state-tile')).toContainText('ready');
  await expect(page.getByTestId('move-start')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('state-tile')).toContainText('ready');

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('confirm-start-yes')).toBeFocused();
  await page.keyboard.press('Enter');
  // the answer is not the Start: the modal comes next, with its own safe answer holding the focus and the way past one ⇧Tab away
  await expect(page.getByTestId('start-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('start-plain')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('state-tile')).toContainText('building');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/tickets/${blocked.key}`);
  await expect(page.getByTestId('state-tile')).toContainText('building');
});

test('s ⏎ ⏎ on a Ticket view writes nothing, at 30, 100 and 400 ms', async ({ page }) => {
  for (const gap of GAPS) {
    const blocked = await blockedTicket(page, `Double${gap}`);
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await twice(page, 'Enter', gap);
    expect((await read(page, blocked.key)).status, `gap ${gap}`).toBe('ready');
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  }
});

test('j s ⏎ ⏎ on a board column writes nothing, at 30, 100 and 400 ms', async ({ page }) => {
  for (const gap of GAPS) {
    const blocked = await blockedTicket(page, `Column${gap}`);
    await page.goto(`/?q=${encodeURIComponent(`Column${gap} blocked`)}`);
    await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await twice(page, 'Enter', gap);
    expect((await read(page, blocked.key)).status, `gap ${gap}`).toBe('ready');
    await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
    await expect(page).toHaveURL(/^[^?]*\/\?q=/);
  }
  await page.keyboard.press('s');
  await expect(page.getByTestId('run-move-start')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-ready-dismiss')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('confirm-ready-yes')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
});

test('s ⏎ ⏎ on a Selection and ⏎ ⏎ on its trash write nothing, at 30, 100 and 400 ms', async ({ page }) => {
  for (const gap of GAPS) {
    const blocked = await blockedTicket(page, `Bulk${gap}`);
    const free = await post<Ticket>(page, '/api/tickets', { title: `Bulk${gap} free`, status: 'ready', app_id: blocked.app, simple: true });
    await page.goto(`/?q=${encodeURIComponent(`Bulk${gap}`)}`);
    await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await twice(page, 'Enter', gap);
    expect((await read(page, blocked.key)).status, `start gap ${gap}`).toBe('ready');
    expect((await read(page, free.key)).status, `start gap ${gap}`).toBe('ready');
    await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);

    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('bulk-confirm-dismiss')).toBeFocused();
    await expect(page.getByTestId('bulk-confirm-yes')).toHaveAttribute('aria-describedby', /./);
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('bulk-confirm-yes')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);

    await page.getByTestId('bulk-trash').focus();
    await twice(page, 'Enter', gap);
    expect((await read(page, blocked.key)).trashed_at, `trash gap ${gap}`).toBeNull();
    expect((await read(page, free.key)).trashed_at, `trash gap ${gap}`).toBeNull();
    await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);
  }
});

test('a held ⏎ asks the question once: its repeats neither answer it nor ask it again (GF-82)', async ({ page }) => {
  const blocked = await blockedTicket(page, 'Heldrepeat');
  await page.getByTestId('move-start').focus();
  await page.keyboard.down('Enter');
  await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();
  // a second `down` with the key still held is what the browser sends as a repeat
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();

  await page.keyboard.down('Enter');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  expect((await read(page, blocked.key)).status).toBe('ready');

  await page.goto('/?q=Heldrepeat');
  await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
  await page.keyboard.press('j');
  await page.keyboard.press('s');
  await expect(page.getByTestId('run-move-start')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-ready-dismiss')).toBeFocused();
  await page.keyboard.down('Enter');
  await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\?q=Heldrepeat$/);
  expect((await read(page, blocked.key)).status).toBe('ready');
});

test('a question never takes the caret out of the filter: not as it stands, not when the board restacks, not when another actor moves its card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const blocked = await blockedTicket(page, 'Caret');
  await page.goto('/?q=Caret%20bl');
  await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
  await page.keyboard.press('j');
  await page.keyboard.press('s');
  await expect(page.getByTestId('run-move-start')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-ready')).toBeVisible();
  await expect(page.getByTestId('confirm-ready-dismiss')).toBeFocused();

  const filter = page.getByLabel('filter by text');
  await filter.click();
  await page.keyboard.press('End');
  await page.keyboard.type('oc', { delay: 60 });
  await expect(filter).toHaveValue('Caret bloc');
  await expect(filter).toBeFocused();
  await expect(page.getByTestId('confirm-ready')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'vertical');
  await page.keyboard.type('k', { delay: 60 });
  await expect(filter).toHaveValue('Caret block');
  await expect(filter).toBeFocused();

  await page.request.post(`/api/tickets/${blocked.key}/unapprove`);
  await expect(page.getByTestId('section-planning').getByTestId(`card-${blocked.key}`)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.type('e', { delay: 60 });
  await expect(filter).toHaveValue('Caret blocke');
  await expect(filter).toBeFocused();
  expect((await read(page, blocked.key)).status).toBe('planning');
});

test('a late refusal shows in place: the page does not move and the caret keeps its tile', async ({ page }) => {
  await page.setViewportSize(BELOW_THE_FOLD);
  const ticket = await post<Ticket>(page, '/api/tickets', { title: 'Late refusal', status: 'todo', simple: true });
  await page.route(`**/api/tickets/${ticket.key}/approve`, async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Refused', status: 409, hint: 'the guard said no, late' }) });
  });
  await page.goto(`/tickets/${ticket.key}`);
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.keyboard.press('a');
  await page.evaluate(() => window.scrollTo(0, 0));
  const editor = page.getByTestId('about-tile').locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('abc', { delay: 30 });
  await expect(page.getByTestId('about-tile')).toHaveClass(/is-focus/);

  await expect(page.getByTestId('state-refusal')).toHaveText('the guard said no, late');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('about-tile')).toHaveClass(/is-focus/);
  await expect(page.getByTestId('state-tile')).not.toHaveClass(/is-focus/);
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('abc');
});

test('esc and leave it hand the focus back to `start`, and ⏎ there asks again rather than opening something else', async ({ page }) => {
  await page.setViewportSize(BELOW_THE_FOLD);
  await blockedTicket(page, 'Askback');
  await askByKey(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await page.getByTestId('confirm-start').getByRole('button', { name: 'leave it' }).click();
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();
});

test('on a Ticket view the question\'s way out is `leave it`, and pressing it leaves the status as it was (GF-45)', async ({ page }) => {
  const blocked = await blockedTicket(page, 'Leaveview');
  await askByKey(page);
  await page.getByTestId('confirm-start').getByRole('button', { name: 'leave it', exact: true }).click();
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await page.waitForTimeout(400);
  expect((await read(page, blocked.key)).status).toBe('ready');
  await expect(page.getByTestId('state-tile')).toContainText('ready');
});

test('with the question open on a Ticket view, one state-tile button is named `cancel`, and it is the lifecycle one (GF-45)', async ({ page }) => {
  await blockedTicket(page, 'Onecancel');
  await askByKey(page);
  const named = page.getByTestId('state-tile').getByRole('button', { name: 'cancel', exact: true });
  await expect(named).toHaveCount(1);
  await expect(named).toHaveAttribute('data-testid', 'move-cancel');
});

test('on the board the question\'s way out is `leave it`, and pressing it leaves the status as it was (GF-45)', async ({ page }) => {
  const blocked = await blockedTicket(page, 'Leaveboard');
  await page.goto(`/?q=${encodeURIComponent('Leaveboard blocked')}`);
  await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
  await page.keyboard.press('j');
  await page.keyboard.press('s');
  await expect(page.getByTestId('run-move-start')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-ready')).toContainText('still blocks this');
  await page.getByTestId('confirm-ready').getByRole('button', { name: 'leave it', exact: true }).click();
  await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
  await page.waitForTimeout(400);
  expect((await read(page, blocked.key)).status).toBe('ready');
});

test('a refused key brings the refusal on screen, and again when it is repeated', async ({ page }) => {
  await page.setViewportSize(BELOW_THE_FOLD);
  await blockedTicket(page, 'Refuse', { status: 'building' });
  await page.keyboard.press('a');
  await expect(page.getByTestId('state-refusal')).toHaveText('a ticket in building does not go back to ready');
  await expect(page.getByTestId('state-refusal')).toBeInViewport();
  await expect(page.getByTestId('state-tile')).toHaveClass(/is-focus/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId('state-refusal')).not.toBeInViewport();
  await page.keyboard.press('a');
  await expect(page.getByTestId('state-refusal')).toBeInViewport();
});

test('esc in the dependency picker hands the focus back to `+ add`', async ({ page }) => {
  const spare = await post<Ticket>(page, '/api/tickets', { title: 'Pickback spare' });
  await blockedTicket(page, 'Pickback');
  await page.keyboard.press('d');
  await expect(page.getByRole('combobox', { name: 'blocked by — search tickets' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
  await expect(page.getByTestId('add-depends_on')).toBeFocused();

  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill(spare.key);
  await expect(page.getByTestId('picker-depends_on').getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('deps-depends_on')).toContainText(spare.key);
  await expect(page.getByTestId('add-depends_on')).toBeFocused();

  await page.getByTestId('add-blocks').click();
  await expect(page.getByRole('combobox', { name: 'blocks — search tickets' })).toBeFocused();
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
/** A rect in page coordinates, so a control measured before a scroll and an answer measured after it share a frame. */
async function pageBox(locator: Locator): Promise<Box> {
  const box = (await locator.boundingBox())!;
  const { x, y } = await locator.page().evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  return { ...box, x: box.x + x, y: box.y + y };
}

const WIDTHS = [390, 768, 1366];
const CLICK_GAPS = [80, 350];

type Armed = { control: Locator; answer: Locator; wrote: () => Promise<boolean> };

const wrote = (page: Page, keys: string[]) => async () => {
  for (const key of keys) {
    const t = await read(page, key);
    if (t.status !== 'ready' || t.trashed_at !== null) return true;
  }
  return false;
};

async function selectedPair(page: Page, tag: string) {
  const blocked = await blockedTicket(page, tag);
  const free = await post<Ticket>(page, '/api/tickets', { title: `${tag} free`, status: 'ready', app_id: blocked.app, simple: true });
  await page.goto(`/?q=${encodeURIComponent(tag)}`);
  await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  return [blocked.key, free.key];
}

/** Each surface armed up to the control whose press asks the question, so one click asks and a second lands wherever the answer is drawn. */
const SURFACES: Record<string, (page: Page, tag: string) => Promise<Armed>> = {
  'the Ticket view': async (page, tag) => {
    const blocked = await blockedTicket(page, tag);
    return { control: page.getByTestId('move-start'), answer: page.getByTestId('confirm-start-yes'), wrote: wrote(page, [blocked.key]) };
  },
  'a board column': async (page, tag) => {
    const blocked = await blockedTicket(page, tag);
    await page.goto(`/?q=${encodeURIComponent(`${tag} blocked`)}`);
    await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('confirm-ready-yes'), wrote: wrote(page, [blocked.key]) };
  },
  'a card': async (page, tag) => {
    const blocked = await blockedTicket(page, tag);
    await page.goto(`/?q=${encodeURIComponent(`${tag} blocked`)}`);
    await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
    await page.getByTestId(`menu-${blocked.key}`).click();
    await expect(page.getByTestId(`menu-${blocked.key}-start`)).toBeVisible();
    return { control: page.getByTestId(`menu-${blocked.key}-start`), answer: page.getByTestId('confirm-ready-yes'), wrote: wrote(page, [blocked.key]) };
  },
  'a bulk start': async (page, tag) => {
    const keys = await selectedPair(page, tag);
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('bulk-confirm-yes'), wrote: wrote(page, keys) };
  },
  'a bulk trash': async (page, tag) => {
    const keys = await selectedPair(page, tag);
    return { control: page.getByTestId('bulk-trash'), answer: page.getByTestId('bulk-confirm-yes'), wrote: wrote(page, keys) };
  },
};

for (const width of WIDTHS)
  for (const [surface, arm] of Object.entries(SURFACES))
    test(`on ${surface} at ${width}px the answer is not drawn under the control that asked, and a double click on that spot writes nothing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const tag = `Spot${width}${surface.replace(/\W/g, '')}`;
      const { control, answer } = await arm(page, `${tag} rect`);
      const spot = await pageBox(control);
      await control.click();
      await expect(answer).toBeVisible();
      const drawn = await pageBox(answer);
      expect(overlaps(spot, drawn), `control ${JSON.stringify(spot)} answer ${JSON.stringify(drawn)}`).toBe(false);

      for (const gap of CLICK_GAPS) {
        const armed = await arm(page, `${tag} gap${gap}`);
        await armed.control.scrollIntoViewIfNeeded();
        const { x, y } = centre((await armed.control.boundingBox())!);
        await page.mouse.click(x, y);
        expect(await armed.answer.count(), `gap ${gap}: the first click asked`).toBe(1);
        await page.waitForTimeout(gap);
        await page.mouse.click(x, y);
        await page.waitForTimeout(400);
        expect(await armed.wrote(), `gap ${gap}`).toBe(false);
      }
    });

test('an OS double click on the bar’s trash asks with its first click and dismisses with its second', async ({ page }) => {
  const keys = await selectedPair(page, 'Dblclick');
  await page.getByTestId('bulk-trash').click();
  await expect(page.getByTestId('bulk-confirm-yes')).toBeVisible();
  await page.getByTestId('bulk-confirm-dismiss').click();
  await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);
  await page.getByTestId('bulk-trash').dblclick();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('bulk-confirm')).toHaveCount(0);
  expect(await wrote(page, keys)()).toBe(false);
});

/** Three blockers wrap the sentence at 390, so the answers take the line's second row, where `start` leads the verb row above. */
async function wrappedTicket(page: Page, tag: string) {
  const blocked = await blockedTicket(page, tag);
  let last = '';
  for (const n of [2, 3]) {
    const blocker = await post<Ticket>(page, '/api/tickets', { title: `${tag} holdup ${n}` });
    await page.request.post(`/api/tickets/${blocked.key}/dependencies`, { data: { blocker: blocker.key } });
    last = blocker.key;
  }
  await page.reload();
  await expect(page.getByTestId('state-blocked')).toContainText(last);
  return blocked;
}

/** `start` pressed with its foot this many pixels above the fold: at 0 the line opens entirely below it. */
const FOOT_GAPS = [0, 15, 30, 45, 60, 75, 90, 105];

for (const footGap of FOOT_GAPS)
  test(`at 390 with a wrapped sentence and start ${footGap}px above the fold, the answer does not land where start was, and a second click there writes nothing`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const blocked = await wrappedTicket(page, `Sweep${footGap}`);
    const start = page.getByTestId('move-start');
    await start.scrollIntoViewIfNeeded();
    const atRest = (await start.boundingBox())!;
    await page.evaluate((by) => window.scrollBy(0, by), atRest.y + atRest.height - (844 - footGap));
    const spot = (await start.boundingBox())!;
    expect(Math.abs(spot.y + spot.height - (844 - footGap)), 'start sits where the sweep put it').toBeLessThanOrEqual(1);
    const { x, y } = centre(spot);
    await page.mouse.click(x, y);
    const answer = page.getByTestId('confirm-start-yes');
    expect(await answer.count(), 'the click asked').toBe(1);
    await page.waitForTimeout(200);
    const drawn = (await answer.boundingBox())!;
    expect(overlaps(spot, drawn), `start ${JSON.stringify(spot)} answer ${JSON.stringify(drawn)}`).toBe(false);
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
    expect((await read(page, blocked.key)).status).toBe('ready');
  });

const WIDE = { width: 1366, height: 768 };
const LONG_DESCRIPTION = Array.from({ length: 60 }, (_, n) => `Paragraph ${n} of a long description.`).join('\n\n');
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
async function press(page: Page, control: Locator) {
  const { x, y } = centre((await control.boundingBox())!);
  await page.mouse.click(x, y);
}

/** Scrolls until the top of `control` sits this many pixels above the viewport, and says where the page rests. */
async function clipTop(control: Locator, by: number) {
  const page = control.page();
  await page.evaluate((down) => window.scrollBy(0, down), (await control.boundingBox())!.y + by);
  expect(Math.abs((await control.boundingBox())!.y + by), 'the control sits where the sweep put it').toBeLessThanOrEqual(1);
  return scrollY(page);
}

for (const by of [3, 29, 40]) {
  async function askedWithStartClipped(page: Page, name: string) {
    await page.setViewportSize(WIDE);
    const blocked = await blockedTicket(page, `${name}${by}`, { description: LONG_DESCRIPTION });
    await page.getByTestId('move-start').click();
    await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();
    return { blocked, rest: await clipTop(page.getByTestId('move-start'), by) };
  }

  test(`with start ${by}px above the top at 1366, a click on leave it leaves the page where it is and the focus on start`, async ({ page }) => {
    const { rest } = await askedWithStartClipped(page, 'StayDismiss');
    await press(page, page.getByTestId('confirm-start-dismiss'));
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
    await expect(page.getByTestId('move-start')).toBeFocused();
    expect(await scrollY(page)).toBe(rest);
  });

  test(`with start ${by}px above the top at 1366, a click on start anyway leaves the page where it is and writes`, async ({ page }) => {
    const { blocked, rest } = await askedWithStartClipped(page, 'StayYes');
    await press(page, page.getByTestId('confirm-start-yes'));
    await page.getByTestId('start-plain').click();
    await expect(page.getByTestId('state-tile')).toContainText('building');
    expect((await read(page, blocked.key)).status).toBe('building');
    expect(await scrollY(page)).toBe(rest);
  });

  for (const [how, close] of [
    ['esc', (page: Page) => page.keyboard.press('Escape')],
    ['⏎ on leave it', (page: Page) => page.keyboard.press('Enter')],
  ] as const)
    test(`with start ${by}px above the top at 1366, ${how} brings start back by the ${by}px it was clipped, no further`, async ({ page }) => {
      const { rest } = await askedWithStartClipped(page, 'KeyBack');
      await close(page);
      await expect(page.getByTestId('confirm-start')).toHaveCount(0);
      await expect(page.getByTestId('move-start')).toBeFocused();
      await expect(page.getByTestId('move-start')).toBeInViewport({ ratio: 0.95 });
      expect(Math.abs((await scrollY(page)) - (rest - by))).toBeLessThanOrEqual(1);
    });

  async function pickingWithAddClipped(page: Page, name: string) {
    await page.setViewportSize(WIDE);
    const spare = await post<Ticket>(page, '/api/tickets', { title: `${name}${by} spare` });
    await blockedTicket(page, `${name}${by}`, { description: LONG_DESCRIPTION });
    await page.getByTestId('add-depends_on').click();
    await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill(spare.key);
    await expect(page.getByTestId(`pick-${spare.key}`)).toBeVisible();
    return { spare, rest: await clipTop(page.getByTestId('add-depends_on'), by) };
  }

  test(`with + add ${by}px above the top at 1366, a click on a candidate leaves the page where it is and the focus on + add`, async ({ page }) => {
    const { spare, rest } = await pickingWithAddClipped(page, 'StayPick');
    await press(page, page.getByTestId(`pick-${spare.key}`));
    await expect(page.getByTestId('deps-depends_on')).toContainText(spare.key);
    await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
    await expect(page.getByTestId('add-depends_on')).toBeFocused();
    expect(await scrollY(page)).toBe(rest);
  });

  test(`with + add ${by}px above the top at 1366, ⏎ on a candidate leaves the page where it is and the focus on + add`, async ({ page }) => {
    const { spare, rest } = await pickingWithAddClipped(page, 'StayEnter');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('deps-depends_on')).toContainText(spare.key);
    await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
    await expect(page.getByTestId('add-depends_on')).toBeFocused();
    expect(await scrollY(page)).toBe(rest);
  });

  test(`with + add ${by}px above the top at 1366, esc in the picker brings + add back by the ${by}px it was clipped, no further`, async ({ page }) => {
    const { rest } = await pickingWithAddClipped(page, 'KeyPick');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
    await expect(page.getByTestId('add-depends_on')).toBeFocused();
    await expect(page.getByTestId('add-depends_on')).toBeInViewport({ ratio: 0.95 });
    expect(Math.abs((await scrollY(page)) - (rest - by))).toBeLessThanOrEqual(1);
  });
}
