import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * DESIGN.md Touch targets, measured (GF-112): a control a finger is meant for is at least 32px on
 * a side under a coarse pointer. A box that a neighbour paints over or a parent clips is not a
 * target however it measures, so the first 32px of it, each way, has to answer as the control.
 */
const FINGER = 32;
/** The bar's links fill the bar, which is 32px with its border: DESIGN.md excuses their height, not their width. */
const BAR_LINK = 30;

/** `null` when the control is a finger wide and answers across it; otherwise what is short about it. */
function shortfall(control: Locator, tall: number): Promise<string | null> {
  return control.evaluate((el, { finger, tall }) => {
    el.scrollIntoView({ block: 'center' });
    // a link wrapped over two lines is one finger's target per line, not the box round both
    const box = el.getClientRects()[0]!;
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const reach = {
      top: [middle.x, box.top + 1],
      bottom: [middle.x, box.top + tall - 1],
      left: [box.left + 1, middle.y],
      right: [box.left + finger - 1, middle.y],
    } as const;
    const covered = Object.entries(reach).flatMap(([edge, [x, y]]) => {
      const hit = document.elementFromPoint(x, y);
      return el === hit || el.contains(hit) ? [] : [`${edge} under ${hit?.tagName ?? 'nothing'}.${hit?.className ?? ''}`];
    });
    const small = box.width < finger || box.height < tall;
    if (!small && !covered.length) return null;
    return [`${box.width}x${box.height}`, ...covered].join(', ');
  }, { finger: FINGER, tall });
}

async function shortfalls(controls: Record<string, Locator>, tall = FINGER): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const [name, control] of Object.entries(controls)) {
    await expect(control, name).toBeVisible();
    const short = await shortfall(control, tall);
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

test('the board, ticket and project controls are 32px on a side, and all of it answers', async ({ page }) => {
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

test('the inputs, tile `+` and one-line links are 32px on a side, and their neighbours still answer', async ({ page }) => {
  const engine = test.info().project.name;
  const app = await post<{ id: number }>(page, '/api/apps', { name: `Links ${engine}`, repository_url: 'https://github.com/o/r' });
  const project = await post<{ id: number }>(page, '/api/projects', { name: `Links ${engine} stack`, app_id: app.id });
  const blockers = await Promise.all([1, 2].map((n) => post<{ key: string }>(page, '/api/tickets', { title: `Links blocker ${n}`, app_id: app.id, project_id: project.id })));
  const ticket = await post<{ key: string }>(page, '/api/tickets', { title: `Links ticket ${engine}`, app_id: app.id, project_id: project.id });
  for (const { key } of blockers) await post(page, `/api/tickets/${ticket.key}/dependencies`, { blocker: key });

  await page.goto('/apps');
  const onApps = await shortfalls({ '+ on apps': page.getByRole('button', { name: 'new app' }) });
  await page.goto('/projects');
  const onProjects = await shortfalls({ '+ on projects': page.getByRole('button', { name: 'new project' }) });

  await page.goto(`/apps/${app.id}`);
  const onApp = await shortfalls({
    '+ on an app': page.getByRole('button', { name: 'new project' }),
    'edit on an app': page.getByRole('button', { name: 'edit app' }),
    'repository link': page.locator('a.gf-path'),
  });

  // the project's kv, under the tile head's `edit`; then its one-line form
  await page.goto(`/projects/${project.id}`);
  const onProject = await shortfalls({ 'project app link': page.locator('.gf-kv dd a'), 'edit on a project': page.getByRole('button', { name: 'edit project' }) });
  await page.locator('button.gf-hint:visible', { hasText: 'new' }).tap();
  const newTicket = await shortfalls({ 'new ticket input': page.locator('.gf-new-ticket input') });

  // a dependency's title pads itself into its row, past which sit the `×` and the next dependency
  await page.goto(`/tickets/${ticket.key}`);
  await expect(page.getByTestId('about-tile')).toBeVisible();
  const rows = page.getByTestId('deps-depends_on').locator('.gf-dep-row');
  await expect(rows).toHaveCount(2);
  const onTicket = await shortfalls({
    'app select': page.getByTestId('app-select'),
    'project select': page.getByTestId('project-select'),
    'first dependency title': rows.first().locator('.gf-row-title'),
    'first dependency ×': rows.first().locator('.gf-dep-drop'),
    'second dependency title': rows.last().locator('.gf-row-title'),
    'second dependency ×': rows.last().locator('.gf-dep-drop'),
  });
  await page.getByTestId('add-label').tap();
  const labelInput = await shortfalls({ 'label input': page.locator('.gf-label-input') });
  await page.keyboard.press('Escape');
  await page.getByTestId('add-depends_on').tap();
  const picker = await shortfalls({ 'picker input': page.getByTestId('picker-depends_on').locator('input') });
  await page.getByTestId('add-depends_on').tap();
  await page.getByTestId('open-palette').tap();
  const palette = await shortfalls({ 'palette input': page.getByTestId('palette').locator('input') });

  // a link's name can be shorter than a finger is wide
  const shortApp = await post<{ id: number }>(page, '/api/apps', { name: 'Go' });
  const shortNamed = await post<{ id: number }>(page, '/api/projects', { name: `Links short ${engine}`, app_id: shortApp.id });
  await page.goto(`/projects/${shortNamed.id}`);
  const onShortName = await shortfalls({ 'project short app link': page.locator('.gf-kv dd a') });

  expect({ ...onApps, ...onProjects, ...onApp, ...onProject, ...newTicket, ...onTicket, ...labelInput, ...picker, ...palette, ...onShortName }).toEqual({});
});

/** The bar's rules before GF-112 made its links a finger wide: what those links are measured against. */
const BAR_BEFORE_GF_112 = `
  .gf-ws a, .gf-bar-key { min-width: 0 !important; }
  .gf-ws { gap: 2px !important; }
  .gf-bar, .gf-counts { gap: var(--gf-s3) !important; }
  .gf-counts a { padding-inline: 6px !important; }
`;

/** The bar counts `apps` apps and `projects` projects, whatever this database has by now. */
async function counting(page: Page, apps: number, projects: number) {
  const rows = (length: number) => Array.from({ length }, (_, n) => ({
    id: n + 1, name: `n${n}`, app_id: null, repository_url: null, default_branch: null, checkout: null, description: '', design: null, archived_at: null, trashed_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }));
  await page.route(/\/api\/apps(\?.*)?$/, (route) => route.fulfill({ json: rows(apps) }));
  await page.route(/\/api\/projects(\?.*)?$/, (route) => route.fulfill({ json: rows(projects) }));
}

test('the bar\'s links are a finger wide, and that does not widen the bar', async ({ page }) => {
  // two-digit counts, the most the bar promises to fit at 360
  await counting(page, 12, 12);
  await page.goto('/');
  await expect(page.locator('.gf-counts b')).toHaveText(['12', '12']);
  const barLinks = await shortfalls(await each(page.locator('.gf-ws a, .gf-bar-key')), BAR_LINK);
  expect(barLinks).toEqual({});
  const barWidth = () => page.evaluate(() => document.querySelector('.gf-bar')!.scrollWidth);
  await page.setViewportSize({ width: 360, height: 640 });
  expect(await barWidth()).toBe(360);
  await page.setViewportSize({ width: 320, height: 640 });
  const withWideLinks = await barWidth();
  // a width in pixels would only hold on one renderer: Linux's Chromium hints `trash` and `settings` 5px wider than macOS draws them
  await page.addStyleTag({ content: BAR_BEFORE_GF_112 });
  expect((await page.locator('.gf-ws a').first().boundingBox())!.width).toBeLessThan(FINGER);
  // 320 overflows, and did before these links: what is held here is that they add nothing to it
  expect(withWideLinks).toBeLessThanOrEqual(await barWidth());
});

// GF-106's run of the whole suite reached 100 apps before the WebKit phone ran, and the page grew 5px wider than it
const COUNTS: [width: number, apps: number, projects: number, fits: boolean][] = [[390, 100, 12, true], [390, 100, 100, true], [360, 1000, 100, false], [320, 12, 12, false]];
for (const [width, apps, projects, fits] of COUNTS) {
  test(`at ${width}px, ${apps} apps and ${projects} projects ${fits ? 'fit the bar' : 'scroll the bar and not the page'}, and ⌘K is a tap away`, async ({ page }) => {
    await counting(page, apps, projects);
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/');
    await expect(page.locator('.gf-counts b')).toHaveText([String(apps), String(projects)]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.evaluate(() => document.querySelector('.gf-bar')!.scrollWidth) === width).toBe(fits);
    await page.getByTestId('open-palette').tap();
    await expect(page.getByTestId('palette').locator('input')).toBeInViewport();
  });
}

test('a long name in the create row leaves the page a phone wide on a fine pointer too', async ({ browser, baseURL }) => {
  const engine = test.info().project.name;
  // the project's phone would otherwise be inherited: a fine pointer is what is under test
  const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 800 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  await post(page, '/api/apps', { name: `A fine pointer's application whose name just keeps going and going, ${engine}` });
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
  await page.getByTestId('hint-new').click();
  await expect(page.getByTestId('board-create')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await context.close();
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
