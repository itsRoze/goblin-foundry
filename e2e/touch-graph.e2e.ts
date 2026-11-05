import { expect, test } from '@playwright/test';

/** Taps in both engines; Chromium also supplies real touch input for the pan. */
test('a graph fits a phone, zooms by tapping, and a dragged link stays on the graph', async ({ page, browserName }) => {
  const response = await page.request.post('/api/projects', { data: { name: 'Touch graph' } });
  const project = await response.json() as { id: number };
  const tickets: { key: string }[] = [];
  for (const title of ['Capture', 'Prepare', 'Read']) {
    const created = await page.request.post('/api/tickets', { data: { title, project_id: project.id } });
    const ticket = await created.json() as { key: string };
    if (tickets.length) await page.request.post(`/api/tickets/${ticket.key}/dependencies`, { data: { blocker: tickets.at(-1)!.key } });
    tickets.push(ticket);
  }
  await page.goto(`/projects/touch-graph-${project.id}`);
  const tile = page.getByTestId('graph-tile');
  const svg = tile.locator('svg');
  await expect(tile.locator('[data-testid^="node-"]')).toHaveCount(3);
  await tile.getByRole('button', { name: 'zoom in', exact: true }).tap();
  await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).tap();
  await expect(tile.locator('.gf-graph-scale')).toHaveText('100%');
  await tile.getByRole('button', { name: 'fit', exact: true }).tap();
  const fitted = await svg.getAttribute('viewBox');
  const node = tile.locator('[data-testid^="node-"]').first();
  if (browserName === 'chromium') {
    await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).tap();
    for (let i = 0; i < 4; i++) await tile.getByRole('button', { name: 'zoom in', exact: true }).tap();
    const beforePan = await svg.getAttribute('viewBox');
    const centreNode = tile.locator('[data-testid^="node-"]').nth(1);
    const box = (await centreNode.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    const url = page.url();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    // Paced like a finger. Sent back to back, the moves end a pan Chromium on Linux treats as
    // still in flight, and the `fit` tap 60ms later gets pointer events but no click (GF-73).
    for (let i = 1; i <= 8; i++) {
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - i * 10 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page).toHaveURL(url);
    const before = beforePan!.split(' ').map(Number);
    const after = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
    // A full gesture keeps moving after capture transfers off the ticket link.
    expect(after[1]! - before[1]!).toBeGreaterThan(30);
    await tile.getByRole('button', { name: 'fit', exact: true }).tap();
    await expect(svg).toHaveAttribute('viewBox', fitted!);
    await tile.getByRole('button', { name: 'reset graph to 100%', exact: true }).tap();
    const canvas = (await svg.boundingBox())!;
    const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: centre.x - 30, y: centre.y }, { id: 2, x: centre.x + 30, y: centre.y }] });
    for (let spread = 35; spread <= 60; spread += 5) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: centre.x - spread, y: centre.y }, { id: 2, x: centre.x + spread, y: centre.y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => parseInt((await tile.locator('.gf-graph-scale').textContent())!)).toBeGreaterThan(150);
    await expect(page).toHaveURL(url);
    await tile.getByRole('button', { name: 'fit', exact: true }).tap();
    await cdp.detach();
  }
  await node.tap();
  await expect(page).toHaveURL(/\/tickets\//);
});

/** A finger is never quite still: a tap that wobbles a few pixels is still a tap (GF-125). */
test('a tap that wobbles opens the Ticket, where a drag would pan', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium takes raw touch points');
  const response = await page.request.post('/api/projects', { data: { name: 'Wobbly graph' } });
  const project = await response.json() as { id: number };
  const created = await page.request.post('/api/tickets', { data: { title: 'Wobble', project_id: project.id } });
  const ticket = await created.json() as { key: string };
  await page.goto(`/projects/wobbly-graph-${project.id}`);
  const node = page.getByTestId('graph-tile').locator('[data-testid^="node-"]');
  await expect(node).toHaveCount(1);
  const box = (await node.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  const press = async (stray: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + stray, y: start.y }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const url = page.url();
  await press(12);
  // past a finger's slop it is the start of a drag, which never opens a ticket
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(url);
  await press(6);
  await cdp.detach();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.key}$`));
});
