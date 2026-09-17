import { expect, test } from '@playwright/test';
import type { CDPSession, Locator, Page } from '@playwright/test';

/**
 * Issue 11's horizontal touch drag, with a real finger as far as emulation
 * goes: the touch events are dispatched through Chromium's own input layer
 * (`Input.dispatchTouchEvent`), not synthesised in the page, so the browser
 * decides what is a scroll and what is a press exactly as it would on a
 * screen. WebKit's automation has no such input layer, so this spec runs in
 * Chromium alone and says so; the tap-driven phone spec covers both engines.
 * The window is a tablet's width, where the board is still a kanban.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'touch gestures are dispatched through CDP, which only Chromium has');

const TABLET = { width: 900, height: 800 };
const HOLD_MS = 500;

const card = (page: Page, title: string) => page.locator('[data-testid^="card-"]', { hasText: title });

async function seed(page: Page, title: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await page.request.post('/api/tickets', { data: { title, ...body } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { key: string }).key;
}

/** Where to put the finger: on screen first, since a column past the tile's edge is somewhere no finger can reach. */
const centre = async (target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 30) };
};

/** One finger, as the browser sees it. */
class Finger {
  constructor(private readonly cdp: CDPSession) {}
  down(at: { x: number; y: number }) {
    return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  }
  /** A few steps, so the browser sees a movement rather than a jump. */
  async moveTo(from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
    for (let i = 1; i <= steps; i += 1) {
      const at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] });
    }
    return to;
  }
  up() {
    return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

test.describe('the horizontal board by finger', () => {
  let finger: Finger;
  let app: { id: number };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TABLET);
    finger = new Finger(await page.context().newCDPSession(page));
    app = await page.request.post('/api/apps', { data: { name: `Touch ${Date.now()}` } }).then((r) => r.json() as Promise<{ id: number }>);
  });

  test('an ordinary swipe scrolls the kanban and moves nothing', async ({ page }) => {
    await seed(page, 'Swiped past');
    await page.goto('/?q=Swiped%20past');
    await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'horizontal');
    const from = await centre(card(page, 'Swiped past'));

    await finger.down(from);
    await finger.moveTo(from, { x: from.x - 250, y: from.y });
    await finger.up();

    await expect.poll(() => page.getByTestId('board').evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByTestId('ghost')).toHaveCount(0);
    await expect(page.getByTestId('col-backlog')).toContainText('Swiped past');
  });

  test('a long-press lifts the card, and letting go over a column is the drop', async ({ page }) => {
    await seed(page, 'Lifted by finger');
    await page.goto('/?q=Lifted%20by%20finger');
    const from = await centre(card(page, 'Lifted by finger'));

    await finger.down(from);
    await page.waitForTimeout(HOLD_MS);
    await expect(page.getByTestId('ghost')).toBeVisible();
    // the legal columns are marked while it is up, as they are for the mouse
    await expect(page.getByTestId('col-todo')).toHaveClass(/is-legal/);
    await expect(page.getByTestId('col-review')).toHaveClass(/is-illegal/);

    await finger.moveTo(from, await centre(page.getByTestId('col-todo')));
    await expect(page.getByTestId('col-todo')).toHaveClass(/is-over/);
    await finger.up();

    await expect(page.getByTestId('col-todo')).toContainText('Lifted by finger');
    await expect(page.getByTestId('col-backlog')).not.toContainText('Lifted by finger');
    await expect(page.getByTestId('ghost')).toHaveCount(0);
    // the tap that ended the drag did not also open the card
    await expect(page).toHaveURL(/\/\?q=/);
  });

  test('a drop where there is no arrow is refused in words, and a release off the columns drops nothing', async ({ page }) => {
    const key = await seed(page, 'In review by finger', { status: 'review', app_id: app.id, simple: true });
    await page.goto('/?q=In%20review%20by%20finger');
    const from = await centre(page.getByTestId(`card-${key}`));

    await finger.down(from);
    await page.waitForTimeout(HOLD_MS);
    await finger.moveTo(from, await centre(page.getByTestId('col-building')));
    await finger.up();
    await expect(page.getByTestId('refusal-building')).toHaveText('a ticket in review does not go back to building');
    await expect(page.getByTestId('col-review')).toContainText('In review by finger');

    // lifted and let go over the filter bar: not a column, so not a move
    await finger.down(from);
    await page.waitForTimeout(HOLD_MS);
    await expect(page.getByTestId('ghost')).toBeVisible();
    await finger.moveTo(from, await centre(page.getByTestId('filter-bar')));
    await finger.up();
    await expect(page.getByTestId('ghost')).toHaveCount(0);
    await expect(page.getByTestId('col-review')).toContainText('In review by finger');
    await expect(page.locator('[data-testid^="refusal-"]')).toHaveCount(0);
  });

  test('a finger at the edge scrolls the kanban to a column that was off screen', async ({ page }) => {
    const key = await seed(page, 'Shipped by finger', { status: 'review', app_id: app.id, simple: true });
    await page.goto('/?q=Shipped%20by%20finger');
    const board = page.getByTestId('board');
    // `done` is past the tile's right edge at this width
    const doneBefore = (await page.getByTestId('col-done').boundingBox())!;
    const edge = (await board.boundingBox())!;
    expect(doneBefore.x + doneBefore.width).toBeGreaterThan(edge.x + edge.width);

    let at = await centre(page.getByTestId(`card-${key}`));
    await finger.down(at);
    await page.waitForTimeout(HOLD_MS);
    await expect(page.getByTestId('ghost')).toBeVisible();
    at = await finger.moveTo(at, { x: edge.x + edge.width - 16, y: at.y });
    await expect.poll(() => board.evaluate((e) => e.scrollLeft)).toBeGreaterThan(50);
    // rest there until the column is in reach, then go to it
    await expect.poll(async () => {
      const box = (await page.getByTestId('col-done').boundingBox())!;
      return box.x + box.width <= edge.x + edge.width;
    }).toBe(true);
    await finger.moveTo(at, await centre(page.getByTestId('col-done')));
    await finger.up();

    await expect(page.getByTestId('col-done')).toContainText('Shipped by finger');
    await expect(page.getByTestId('col-review')).not.toContainText('Shipped by finger');
  });
});
