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
  // the waiting node wears the kanban's hollow ◇, never a colour (DESIGN.md Colors)
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
  await page.getByTestId('graph').getByRole('link', { name: /The lamp/ }).click();
  await expect(page.getByTestId('page-title')).toContainText('The lamp');
});

test('a blocker in another project is drawn once, mute, and opens like any other node', async ({ page }) => {
  // a second project in the same app, with one ticket in it to block across the boundary
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Graphing' }).click();
  await page.getByRole('button', { name: 'new project' }).click();
  const projectForm = page.getByTestId('new-project-form');
  await projectForm.getByLabel('name').fill('Elsewhere');
  await projectForm.getByLabel('name').press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/projects\/elsewhere-\d+$/);

  await expect(page.getByTestId('tickets-tile')).toBeVisible();
  await page.keyboard.press('c');
  const form = page.getByTestId('new-ticket');
  await form.getByLabel('ticket title').fill('The mains supply');
  await form.getByLabel('ticket title').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('ticket-rows')).toContainText('The mains supply');

  // declare it as a blocker of a ticket in the *other* project
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Wiring' }).click();
  await page.getByTestId('ticket-rows').getByRole('link', { name: /The lamp/ }).click();
  await page.getByTestId('add-depends_on').click();
  await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill('The mains supply');
  await page.getByTestId('picker-depends_on').getByRole('option').filter({ hasText: 'The mains supply' }).click();
  await expect(page.getByTestId('deps-depends_on')).toContainText('The mains supply');

  await page.getByTestId('page-title').getByRole('link', { name: 'Wiring' }).click();
  const external = page.locator('.gf-graph-node.is-external');
  await expect(external).toHaveCount(1);
  await expect(external).toHaveAccessibleName(/The mains supply/);
  // context, not subject: no status treatment, and nothing of its own drawn behind it
  await expect(external).not.toHaveClass(/is-blocked/);
  await expect(nodes(page)).toHaveCount(3);

  // the popover is where it says which project it came from
  await external.hover();
  await expect(page.getByTestId('graph-popover')).toContainText('Graphing / Elsewhere');

  // and it opens like any other node
  await external.click();
  await expect(page.getByTestId('page-title')).toContainText('The mains supply');
});

test('a node says what it is: on hover after a beat, and the moment it takes focus', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Wiring' }).click();
  const lamp = page.getByTestId('graph').getByRole('link', { name: /The lamp/ });
  await expect(lamp).toBeVisible();

  await lamp.hover();
  await expect(page.getByTestId('graph-popover')).toContainText('The lamp');

  // the same on focus, which is also what says the node is reachable by `tab` at all
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('graph-popover')).toBeHidden();
  await lamp.focus();
  await expect(page.getByTestId('graph-popover')).toContainText('The lamp');
});

test('the graph fits its tile without scrolling the graph or page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Wiring' }).click();
  await expect(page.getByTestId('graph')).toBeVisible();

  const measured = await page.evaluate(() => {
    const box = document.querySelector('.gf-graph')!;
    const doc = document.documentElement;
    return { pageOverflow: doc.scrollWidth - doc.clientWidth, graphScrollsInside: box.scrollWidth > box.clientWidth };
  });
  expect(measured).toEqual({ pageOverflow: 0, graphScrollsInside: false });
});

test('a fitted graph supports zoom, pan, reset and keyboard ticket navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Wiring' }).click();
  const svg = page.getByTestId('graph').locator('svg');
  const tile = graph(page);
  await tile.getByRole('button', { name: 'fit', exact: true }).click();
  const initial = await svg.getAttribute('viewBox');
  await tile.getByRole('button', { name: 'zoom in', exact: true }).click();
  await expect(svg).not.toHaveAttribute('viewBox', initial!);
  await tile.getByRole('button', { name: 'fit', exact: true }).click();
  await expect(svg).toHaveAttribute('viewBox', initial!);
  await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).click();
  await expect(tile.locator('.gf-graph-scale')).toHaveText('100%');
  await svg.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('+');
  const beforeArrow = await svg.getAttribute('viewBox');
  await page.keyboard.press('ArrowDown');
  await expect(svg).not.toHaveAttribute('viewBox', beforeArrow!);
  await page.keyboard.press('0');
  await expect(svg).toHaveAttribute('viewBox', initial!);

  // Dragging from a ticket pans without following its link.
  await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).click();
  for (let i = 0; i < 4; i++) await tile.getByRole('button', { name: 'zoom in', exact: true }).click();
  const node = nodes(page).first();
  const rect = (await node.boundingBox())!;
  const url = page.url();
  await page.mouse.move(rect.x + rect.width - 12, rect.y + 12);
  await page.mouse.down();
  await page.mouse.move(rect.x + 20, rect.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(url);
  await expect(svg).not.toHaveAttribute('viewBox', initial!);

  // A press that leaves before capture must not turn subsequent hover into a drag.
  const viewport = (await svg.boundingBox())!;
  await page.mouse.move(viewport.x + 1, viewport.y + 10);
  await page.mouse.down();
  await page.mouse.move(viewport.x - 2, viewport.y + 10);
  await page.mouse.up();
  const afterRelease = await svg.getAttribute('viewBox');
  await page.mouse.move(viewport.x + 30, viewport.y + 10);
  await page.mouse.move(viewport.x + 110, viewport.y + 10);
  await expect(svg).toHaveAttribute('viewBox', afterRelease!);
  await expect(page.getByTestId('graph')).not.toHaveClass(/is-panning/);

  await tile.getByRole('button', { name: 'fit', exact: true }).click();
  await svg.focus();
  await page.keyboard.press('Tab');
  await expect(nodes(page).first()).toBeFocused();
  await expect(tile.locator('.gf-graph-scale')).toHaveText('100%');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tickets\//);
});

test('a large graph starts fitted, zooms around the pointer, and expands without moving the project', async ({ page }, testInfo) => {
  const project = await page.request.post('/api/projects', { data: { name: 'Readable graph' } }).then((r) => r.json() as Promise<{ id: number }>);
  const keys: string[] = [];
  const titles = ['Design the reading experience', 'Prepare a finite morning edition', 'Keep articles available offline', 'Synchronize annotations to Readwise'];
  for (let i = 0; i < 22; i++) {
    const ticket = await page.request.post('/api/tickets', { data: { project_id: project.id, title: titles[i % titles.length], status: 'planning' } }).then((r) => r.json() as Promise<{ key: string }>);
    keys.push(ticket.key);
    if (i > 0) await page.request.post(`/api/tickets/${ticket.key}/dependencies`, { data: { blocker: keys[Math.max(0, i - 4)] } });
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/projects/readable-graph-${project.id}`);
  const tile = graph(page);
  const svg = tile.locator('svg');
  await expect(nodes(page)).toHaveCount(22);
  await tile.getByRole('button', { name: 'fit', exact: true }).click();
  const fitted = await svg.getAttribute('viewBox');
  await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).click();
  await tile.screenshot({ path: testInfo.outputPath('graph-readable.png') });
  const box = (await svg.boundingBox())!;
  const point = { x: box.width * 0.6, y: box.height * 0.6 };
  await page.mouse.move(box.x + point.x, box.y + point.y);
  const before = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Control');
  await expect(tile.locator('.gf-graph-scale')).not.toHaveText('100%');
  const after = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  expect(Math.abs((before[0]! + point.x * before[2]! / box.width) - (after[0]! + point.x * after[2]! / box.width))).toBeLessThan(1);
  const camera = await svg.getAttribute('viewBox');
  await page.mouse.wheel(90, 0);
  await expect(svg).not.toHaveAttribute('viewBox', camera!);
  await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).click();
  const tileHeight = (await tile.boundingBox())!.height;
  await tile.getByRole('button', { name: 'expand', exact: true }).click();
  const expanded = page.getByRole('dialog', { name: 'dependency graph' });
  await expect(expanded).toBeVisible();
  expect((await expanded.locator('svg').boundingBox())!.width).toBeGreaterThan(900);
  await expanded.screenshot({ path: testInfo.outputPath('graph-expanded.png') });
  await page.keyboard.press('Escape');
  await expect(expanded).toHaveCount(0);
  await expect(tile.getByRole('button', { name: 'expand', exact: true })).toBeFocused();
  expect(Math.abs((await tile.boundingBox())!.height - tileHeight)).toBeLessThan(2);
  expect(fitted).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await tile.getByRole('button', { name: 'fit', exact: true }).click();
  await tile.screenshot({ path: testInfo.outputPath('graph-phone.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('hover and keyboard focus trace entire chains without highlighting sibling branches', async ({ page }) => {
  const project = await page.request.post('/api/projects', { data: { name: 'Trace paths' } }).then((r) => r.json() as Promise<{ id: number }>);
  const keys: string[] = [];
  for (const title of ['Source', 'Prepare', 'Read', 'Annotate', 'Export', 'Unrelated branch']) {
    const ticket = await page.request.post('/api/tickets', { data: { project_id: project.id, title } }).then((r) => r.json() as Promise<{ key: string }>);
    keys.push(ticket.key);
  }
  for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5]]) {
    await page.request.post(`/api/tickets/${keys[to!]}/dependencies`, { data: { blocker: keys[from!] } });
  }
  await page.goto(`/projects/trace-paths-${project.id}`);
  const tile = graph(page);
  const read = page.getByTestId(`node-${keys[2]}`);
  await read.hover();
  await expect(tile.getByTestId('graph-popover')).toContainText('2 prerequisites · 2 downstream tickets');
  await expect(page.getByTestId(`edge-${keys[0]}-${keys[1]}`)).toHaveClass(/is-upstream/);
  await expect(page.getByTestId(`edge-${keys[3]}-${keys[4]}`)).toHaveClass(/is-downstream/);
  await expect(page.getByTestId(`edge-${keys[1]}-${keys[5]}`)).toHaveClass(/is-unrelated/);
  await page.mouse.move(0, 0);
  await expect(page.getByTestId(`edge-${keys[0]}-${keys[1]}`)).not.toHaveClass(/is-upstream/);
  await read.focus();
  await expect(tile.getByTestId('graph-popover')).toContainText('2 prerequisites · 2 downstream tickets');
  await read.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tickets/${keys[2]}`));
});
