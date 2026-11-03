import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Named to run late: the earlier specs count tickets and address keys by name. */

const BELOW_THE_FOLD = { width: 500, height: 723 };

type Ticket = { key: string };

const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;
const read = async (page: Page, key: string) => (await (await page.request.get(`/api/tickets/${key}`)).json()) as { status: string; trashed_at: string | null };

async function blockedTicket(page: Page, name: string, fields: object = {}) {
  const app = await post<{ id: number }>(page, '/api/apps', { name: `${name} app` });
  const blocker = await post<Ticket>(page, '/api/tickets', { title: 'Holdup' });
  const blocked = await post<Ticket>(page, '/api/tickets', { title: `${name} blocked`, status: 'ready', app_id: app.id, simple: true, ...fields });
  await page.request.post(`/api/tickets/${blocked.key}/dependencies`, { data: { blocker: blocker.key } });
  await page.goto(`/tickets/${blocked.key}`);
  await expect(page.getByTestId('state-tile')).toBeVisible();
  return { ...blocked, app: app.id };
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

test('s ⏎ on a blocked Ticket puts the question on screen with the focus on cancel, so ⏎ dismisses it and ⇧Tab ⏎ answers it (GF-44, GF-84)', async ({ page }) => {
  await page.setViewportSize(BELOW_THE_FOLD);
  const blocked = await blockedTicket(page, 'Askfocus');
  await askByKey(page);
  await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();
  await expect(page.getByTestId('confirm-start-cancel')).toBeInViewport();
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
  // the answer reads before `cancel`, as on every form, so it is one ⇧Tab away and never a lifecycle button
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('confirm-start-yes')).toBeFocused();
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
    await expect(page.getByTestId('bulk-confirm-cancel')).toBeFocused();
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
  await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();
  // a second `down` with the key still held is what the browser sends as a repeat
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await expect(page.getByTestId('confirm-start-cancel')).toBeFocused();

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
  await expect(page.getByTestId('confirm-ready-cancel')).toBeFocused();
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
  await expect(page.getByTestId('confirm-ready-cancel')).toBeFocused();

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

test('esc and cancel hand the focus back to `start`, and ⏎ there asks again rather than opening something else', async ({ page }) => {
  await page.setViewportSize(BELOW_THE_FOLD);
  await blockedTicket(page, 'Askback');
  await askByKey(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await page.getByTestId('confirm-start').getByRole('button', { name: 'cancel' }).click();
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  await expect(page.getByTestId('move-start')).toBeFocused();
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

const WIDTHS = [390, 430, 768, 1024, 1366];
const CLICK_GAPS = [80, 200, 350, 600];

type Armed = { control: Locator; answer: Locator; wrote: () => Promise<boolean> };

const unchanged = (page: Page, keys: string[]) => async () => {
  for (const key of keys) {
    const t = await read(page, key);
    if (t.status !== 'ready' || t.trashed_at !== null) return true;
  }
  return false;
};

async function pair(page: Page, tag: string) {
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
    return { control: page.getByTestId('move-start'), answer: page.getByTestId('confirm-start-yes'), wrote: unchanged(page, [blocked.key]) };
  },
  'a board column': async (page, tag) => {
    const blocked = await blockedTicket(page, tag);
    await page.goto(`/?q=${encodeURIComponent(`${tag} blocked`)}`);
    await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('confirm-ready-yes'), wrote: unchanged(page, [blocked.key]) };
  },
  'a card': async (page, tag) => {
    const blocked = await blockedTicket(page, tag);
    await page.goto(`/?q=${encodeURIComponent(`${tag} blocked`)}`);
    await expect(page.getByTestId(`card-${blocked.key}`)).toBeVisible();
    await page.getByTestId(`menu-${blocked.key}`).click();
    await expect(page.getByTestId(`menu-${blocked.key}-start`)).toBeVisible();
    return { control: page.getByTestId(`menu-${blocked.key}-start`), answer: page.getByTestId('confirm-ready-yes'), wrote: unchanged(page, [blocked.key]) };
  },
  'a bulk start': async (page, tag) => {
    const keys = await pair(page, tag);
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    return { control: page.getByTestId('run-move-start'), answer: page.getByTestId('bulk-confirm-yes'), wrote: unchanged(page, keys) };
  },
  'a bulk trash': async (page, tag) => {
    const keys = await pair(page, tag);
    return { control: page.getByTestId('bulk-trash'), answer: page.getByTestId('bulk-confirm-yes'), wrote: unchanged(page, keys) };
  },
};

for (const width of WIDTHS)
  for (const [surface, arm] of Object.entries(SURFACES))
    test(`on ${surface} at ${width}px the answer is not drawn under the control that asked, and a double click on that spot writes nothing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const tag = `Spot${width}${surface.replace(/\W/g, '')}`;
      const { control, answer } = await arm(page, `${tag} rect`);
      const spot = (await control.boundingBox())!;
      await control.click();
      await expect(answer).toBeVisible();
      const drawn = (await answer.boundingBox())!;
      expect(overlaps(spot, drawn), `control ${JSON.stringify(spot)} answer ${JSON.stringify(drawn)}`).toBe(false);

      for (const gap of CLICK_GAPS) {
        const armed = await arm(page, `${tag} gap${gap}`);
        const { x, y } = centre((await armed.control.boundingBox())!);
        await page.mouse.click(x, y);
        await page.waitForTimeout(gap);
        await page.mouse.click(x, y);
        await page.waitForTimeout(400);
        expect(await armed.wrote(), `gap ${gap}`).toBe(false);
      }
    });

test('an OS double click on the bar’s trash asks and writes nothing', async ({ page }) => {
  const keys = await pair(page, 'Dblclick');
  await page.getByTestId('bulk-trash').dblclick();
  await page.waitForTimeout(400);
  expect(await unchanged(page, keys)()).toBe(false);
});
