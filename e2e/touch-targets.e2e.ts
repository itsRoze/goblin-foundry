import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * DESIGN.md Touch targets, measured (GF-112): a control a finger is meant for is at least 32px on
 * a side under a coarse pointer. A box that a neighbour paints over or a parent clips is not a
 * target however it measures, so the first 32px of it, each way, has to answer as the control.
 */
const FINGER = 32;

/** `null` when the control is a finger wide and answers across it; otherwise what is short about it. */
function shortfall(control: Locator): Promise<string | null> {
  return control.evaluate((el, finger) => {
    el.scrollIntoView({ block: 'center' });
    // a link wrapped over two lines is one finger's target per line, not the box round both
    const box = el.getClientRects()[0]!;
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const reach = {
      top: [middle.x, box.top + 1],
      bottom: [middle.x, box.top + finger - 1],
      left: [box.left + 1, middle.y],
      right: [box.left + finger - 1, middle.y],
    } as const;
    const covered = Object.entries(reach).flatMap(([edge, [x, y]]) => {
      const hit = document.elementFromPoint(x, y);
      return el === hit || el.contains(hit) ? [] : [`${edge} under ${hit?.tagName ?? 'nothing'}.${hit?.className ?? ''}`];
    });
    const small = box.width < finger || box.height < finger;
    if (!small && !covered.length) return null;
    return [`${box.width}x${box.height}`, ...covered].join(', ');
  }, FINGER);
}

async function shortfalls(controls: Record<string, Locator>): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const [name, control] of Object.entries(controls)) {
    await expect(control, name).toBeVisible();
    const short = await shortfall(control);
    if (short) found[name] = short;
  }
  return found;
}

/** Every visible match of `controls`, however many a state happens to offer, each named for its words. */
async function each(controls: Locator): Promise<Record<string, Locator>> {
  const found = await controls.all();
  expect(found.length).toBeGreaterThan(0);
  const named = await Promise.all(found.map(async (control, n) => [`${(await control.innerText()).replace(/\s+/g, ' ')} (${n})`, control] as const));
  return Object.fromEntries(named);
}

async function post<T>(page: Page, path: string, data: Record<string, unknown>): Promise<T> {
  const response = await page.request.post(path, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

test('every control a finger is meant for is 32px on a side, and all of it answers', async ({ page }) => {
  const engine = test.info().project.name;
  // long enough that the project's link wraps under the app's, whose hit area it must not cover
  const app = await post<{ id: number }>(page, '/api/apps', { name: `Reach ${engine}` });
  const project = await post<{ id: number }>(page, '/api/projects', { name: `Reach ${engine} stacks`, app_id: app.id });
  const blocker = await post<{ key: string }>(page, '/api/tickets', { title: `Reach blocker ${engine}`, app_id: app.id, project_id: project.id });
  const ticket = await post<{ key: string }>(page, '/api/tickets', { title: `Reach ticket ${engine}`, app_id: app.id, project_id: project.id, status: 'planning' });
  await post(page, `/api/tickets/${ticket.key}/dependencies`, { blocker: blocker.key });

  // the board, with a filter set so that its `×` is live
  await page.goto(`/?q=${encodeURIComponent(`Reach ticket ${engine}`)}`);
  await expect(page.getByTestId(`card-${ticket.key}`)).toBeVisible();
  const onBoard = await shortfalls({
    ...(await each(page.locator('button.gf-hint:visible'))),
    'filter input': page.getByLabel('filter by text'),
    'filter ×': page.getByRole('button', { name: 'clear filters' }),
  });

  // the create row
  await page.getByTestId('hint-new').tap();
  const row = page.getByTestId('board-create');
  const creating = await shortfalls({
    'create title': row.getByLabel('ticket title'),
    'create app': row.getByLabel('app'),
    'create project': row.getByLabel('project'),
    'create status': row.getByLabel('status'),
  });
  await row.getByTestId('form-cancel').tap();

  // the ticket: its app and project links, its selects, its title at rest and open, its URL fields
  await page.goto(`/tickets/${ticket.key}`);
  await expect(page.getByTestId('about-tile')).toBeVisible();
  const links = page.getByTestId('page-title').getByRole('link');
  const projectPath = (await links.last().getAttribute('href'))!;
  const onTicket = await shortfalls({
    ...(await each(page.locator('button.gf-hint:visible'))),
    'H1 app link': links.first(),
    'H1 project link': links.last(),
    'app select': page.getByTestId('app-select'),
    'project select': page.getByTestId('project-select'),
    'title at rest': page.getByTestId('ticket-title'),
    'implementation URL input': page.getByLabel('PR or commit URL'),
  });
  await page.getByTestId('ticket-title').tap();
  const titleOpen = await shortfalls({ 'title input': page.getByLabel('title', { exact: true }) });
  await page.getByTestId('title-cancel').tap();
  const tile = page.getByTestId('design-tile');
  await tile.locator('.gf-doc').tap();
  await page.keyboard.type('the planner');
  // while `saving…` sits beside it, Playwright's WebKit answers the lower half of this box with the line behind it, at the same size
  await expect(tile.getByTestId('saving')).toHaveText('saved');
  await page.keyboard.press('ControlOrMeta+A');
  await tile.getByTestId('fmt-link').tap();
  const designOpen = await shortfalls({ 'link URL input': tile.getByLabel('link url') });
  await tile.getByTestId('link-cancel').tap();

  // the project: its graph's zoom, and the H1 with one link
  await page.goto(projectPath);
  const graph = page.getByTestId('graph-tile');
  await expect(graph).toBeVisible();
  const onProject = await shortfalls({
    'zoom out': graph.getByRole('button', { name: 'zoom out', exact: true }),
    'zoom in': graph.getByRole('button', { name: 'zoom in', exact: true }),
    'H1 app link on a project': page.getByTestId('page-title').getByRole('link'),
  });

  // a link's name can be shorter than a finger is wide
  const shortApp = await post<{ id: number }>(page, '/api/apps', { name: 'Go' });
  const shortNamed = await post<{ key: string }>(page, '/api/tickets', { title: `Reach short ${engine}`, app_id: shortApp.id });
  await page.goto(`/tickets/${shortNamed.key}`);
  const onShortName = await shortfalls({ 'H1 short app link': page.getByTestId('page-title').getByRole('link') });

  // a form field's input and select sit in one row, so they are one height
  await page.goto('/settings');
  await page.getByTestId('hint-edit').tap();
  const form = page.getByTestId('settings-form');
  const onSettings = await shortfalls({ 'form input': form.locator('input').first(), 'form select': form.locator('select').first() });
  await form.getByRole('button', { name: /cancel/ }).tap();

  expect({ ...onBoard, ...creating, ...onTicket, ...titleOpen, ...designOpen, ...onProject, ...onShortName, ...onSettings }).toEqual({});
});

test('a long name among a select\'s options leaves the page a phone wide, so 32px stays 32px', async ({ page }) => {
  const engine = test.info().project.name;
  await post(page, '/api/apps', { name: `An application whose name just keeps going and going, ${engine}` });
  const ticket = await post<{ key: string }>(page, '/api/tickets', { title: `Reach narrow ${engine}` });
  await page.goto(`/tickets/${ticket.key}`);
  await expect(page.getByTestId('about-tile')).toBeVisible();
  // a phone zooms a page wider than itself out to fit, and every control shrinks under the finger with it
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  const select = (await page.getByTestId('app-select').boundingBox())!;
  const tile = (await page.getByTestId('about-tile').boundingBox())!;
  expect(select.x + select.width).toBeLessThanOrEqual(tile.x + tile.width);
  // the board's create row lists the same names
  await page.goto('/');
  await page.getByTestId('hint-new').tap();
  await expect(page.getByTestId('board-create')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
});
