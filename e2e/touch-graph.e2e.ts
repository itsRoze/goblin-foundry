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
    for (let i = 1; i <= 8; i++) {
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
