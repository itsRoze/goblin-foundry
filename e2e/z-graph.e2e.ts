import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue 08's exit criterion: a project draws its tickets as diamonds and its
 * edges as steps, the edge goes solid when the blocker ships, and a node is a
 * way into the ticket. Prefixed to sort after `z-dependencies.e2e.ts` — one
 * worker shares one database, and the earlier specs count tickets and address
 * `GF-1` by name.
 */

const graph = (page: Page) => page.getByTestId('graph-tile');
const nodes = (page: Page) => page.locator('[data-testid^="node-"]');
const edges = (page: Page) => page.locator('.gf-graph-edge');

/** Give a ticket what the approve guard wants, so it can be walked to `done`. */
async function makeSimple(page: Page) {
  await expect(page.getByTestId('state-tile')).toBeVisible();
  await page.getByTestId('simple-toggle').click();
  await expect(page.getByTestId('simple-toggle')).toBeChecked();
}

test('a project graphs its tickets: a dashed edge goes solid when the blocker ships, and a node opens the ticket', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'new app' }).click();
  const appForm = page.getByTestId('new-app-form');
  await appForm.getByLabel('name').fill('Graphing');
  await appForm.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/apps\/graphing-\d+$/);

  await page.getByRole('button', { name: 'new project' }).click();
  const projectForm = page.getByTestId('new-project-form');
  await projectForm.getByLabel('name').fill('Wiring');
  await projectForm.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/projects\/wiring-\d+$/);
  const project = page.url();

  // nothing to draw yet: the tile says so rather than showing an empty box
  await expect(graph(page)).toContainText('no tickets');

  await expect(page.getByTestId('tickets-tile')).toBeVisible();
  for (const title of ['The wiring', 'The lamp']) {
    await page.keyboard.press('c');
    const form = page.getByTestId('new-ticket');
    await form.getByLabel('ticket title').fill(title);
    await form.getByLabel('ticket title').press('ControlOrMeta+Enter');
    await expect(page.getByTestId('ticket-rows')).toContainText(title);
  }
  // tickets but no edges is still a rank of diamonds, and the legend says what is missing
  await expect(graph(page)).toContainText('2 tickets · 0 edges');
  await expect(page.getByTestId('graph-legend')).toHaveText('no dependencies yet — declare one from a ticket');
  await expect(nodes(page)).toHaveCount(2);

  // declare the edge from the ticket that waits (ADR-0004), and make it shippable while we are there
  await page.getByTestId('ticket-rows').getByRole('link', { name: /The lamp/ }).click();
  await makeSimple(page);
  await page.getByTestId('add-depends_on').click();
  await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill('The wiring');
  await page.getByTestId('picker-depends_on').getByRole('option').filter({ hasText: 'The wiring' }).click();
  await expect(page.getByTestId('history')).toContainText('blocked by GF-');

  // back by the crumb, not by a reload: the graph read is invalidated with the write, so the
  // edge is on the drawing without the page being fetched again
  await page.getByTestId('page-title').getByRole('link', { name: 'Wiring' }).click();
  await expect(graph(page)).toContainText('2 tickets · 1 edge');
  await expect(nodes(page)).toHaveCount(2);
  await expect(edges(page)).toHaveCount(1);
  await expect(edges(page)).toHaveClass(/is-open/);
  // the waiting node wears the kanban's hollow ◇, never a colour (DESIGN.md §3)
  await expect(page.locator('.gf-graph-node.is-blocked')).toHaveCount(1);
  await expect(page.getByTestId('graph-legend')).toContainText('dashed while the blocker is open');

  // ship the blocker: the edge stays — it is a durable fact — and goes solid (ADR-0009)
  await page.getByTestId('ticket-rows').getByRole('link', { name: /The wiring/ }).click();
  await makeSimple(page);
  for (const name of ['pick', 'approve', 'start', 'submit', 'ship']) await page.getByTestId(`move-${name}`).click();
  await expect(page.getByTestId('state-tile')).toContainText('done');

  await page.goto(project);
  await expect(edges(page)).toHaveCount(1);
  await expect(edges(page)).not.toHaveClass(/is-open/);
  await expect(page.locator('.gf-graph-node.is-blocked')).toHaveCount(0);

  // the whole node is the link
  await page.locator('[data-testid^="node-"]', { hasText: 'The lamp' }).click();
  await expect(page.getByTestId('page-title')).toContainText('The lamp');
});

test('a node says what it is: on hover after a beat, and the moment it takes focus', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Wiring' }).click();
  const lamp = page.locator('[data-testid^="node-"]', { hasText: 'The lamp' });
  await expect(lamp).toBeVisible();

  await lamp.hover();
  await expect(page.getByTestId('graph-popover')).toContainText('The lamp');

  // the same on focus, which is also what says the node is reachable by `tab` at all
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('graph-popover')).toBeHidden();
  await lamp.focus();
  await expect(page.getByTestId('graph-popover')).toContainText('The lamp');
});

test('the graph scrolls inside its own tile, never the page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Wiring' }).click();
  await expect(page.getByTestId('graph')).toBeVisible();

  const measured = await page.evaluate(() => {
    const box = document.querySelector('.gf-graph')!;
    const doc = document.documentElement;
    return { pageOverflow: doc.scrollWidth - doc.clientWidth, graphScrollsInside: box.scrollWidth > box.clientWidth };
  });
  expect(measured).toEqual({ pageOverflow: 0, graphScrollsInside: true });
});
