import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Named to run after the desktop specs, whose palette rows these projects and apps would crowd. */

type Ticket = { key: string; title: string; description: string };
type Named = { id: number; name: string; description: string };

const post = async <T>(page: Page, path: string, data: object) => (await (await page.request.post(path, { data })).json()) as T;
const read = async <T>(page: Page, path: string) => (await (await page.request.get(path)).json()) as T;

const expectTitle = (page: Page, text: string) => expect(page.getByTestId('page-title')).toContainText(text);

async function follow(page: Page, to: Ticket) {
  await page.getByTestId('deps-depends_on').getByRole('link', { name: to.key }).click();
  await expectTitle(page, to.title);
}

async function onBlockedTicketWithBothCached(page: Page, name: string, fields: object = {}) {
  const to = await post<Ticket>(page, '/api/tickets', { title: `${name} destination`, description: `${name} destination words`, status: 'planning' });
  const from = await post<Ticket>(page, '/api/tickets', { title: `${name} origin`, description: `${name} origin words`, status: 'planning', ...fields });
  await page.request.post(`/api/tickets/${from.key}/dependencies`, { data: { blocker: to.key } });
  await page.goto(`/tickets/${from.key}`);
  await expectTitle(page, from.title);
  await follow(page, to);
  await page.goBack();
  await expectTitle(page, from.title);
  return { from, to };
}

async function onFirstWithBothCached(page: Page, kind: 'apps' | 'projects', first: Named, second: Named) {
  await page.goto(`/${kind}/${first.id}`);
  await expectTitle(page, first.name);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill(second.name);
  await page.keyboard.press('Enter');
  await expectTitle(page, second.name);
  await page.goBack();
  await expectTitle(page, first.name);
}

async function typeInto(page: Page, testId: string) {
  await page.getByTestId(testId).locator('.gf-doc').click();
  await page.keyboard.type(' stray');
}

const descriptionOf = (page: Page, path: string) => read<{ description: string }>(page, path).then((body) => body.description);

test('an open dependency picker does not follow a link to the next Ticket (GF-76)', async ({ page }) => {
  const { to } = await onBlockedTicketWithBothCached(page, 'Pickroam');
  const spare = await post<Ticket>(page, '/api/tickets', { title: 'Pickroam spare', status: 'planning' });
  await page.keyboard.press('d');
  await page.getByRole('combobox', { name: 'blocked by — search tickets' }).fill(spare.key);
  await expect(page.getByTestId('picker-depends_on').getByRole('option')).toHaveCount(1);
  await follow(page, to);
  await expect(page.getByTestId('picker-depends_on')).toHaveCount(0);
});

test('an open title editor does not follow a link to the next Ticket (GF-76)', async ({ page }) => {
  const { from, to } = await onBlockedTicketWithBothCached(page, 'Titleroam');
  await page.getByTestId('ticket-title').click();
  await expect(page.getByTestId('title-edit').getByLabel('title')).toHaveValue(from.title);
  await follow(page, to);
  await expect(page.getByTestId('title-edit')).toHaveCount(0);
  await expect(page.getByTestId('ticket-title')).toHaveText(to.title);
});

test('the start question does not follow a link to the next Ticket (GF-76)', async ({ page }) => {
  const app = await post<Named>(page, '/api/apps', { name: 'Askroam app' });
  const { to } = await onBlockedTicketWithBothCached(page, 'Askroam', { status: 'ready', app_id: app.id, simple: true });
  await page.getByTestId('move-start').click();
  await expect(page.getByTestId('confirm-start')).toContainText('still blocks this');
  await follow(page, to);
  await expect(page.getByTestId('confirm-start')).toHaveCount(0);
});

test('a new project form does not follow history to the next App (GF-76)', async ({ page }) => {
  const first = await post<Named>(page, '/api/apps', { name: 'Formroam first' });
  const second = await post<Named>(page, '/api/apps', { name: 'Formroam second' });
  await onFirstWithBothCached(page, 'apps', first, second);
  await page.getByRole('button', { name: 'new project' }).click();
  await expect(page.getByTestId('new-project-form')).toBeVisible();
  await page.goForward();
  await expectTitle(page, second.name);
  await expect(page.getByTestId('new-project-form')).toHaveCount(0);
});

test('text typed into a Ticket reaches that Ticket when history leaves with the caret in it (GF-76)', async ({ page }) => {
  const { from, to } = await onBlockedTicketWithBothCached(page, 'Typeroam');
  await typeInto(page, 'description');
  await page.goForward();
  await expectTitle(page, to.title);
  await expect.poll(() => descriptionOf(page, `/api/tickets/${from.key}`)).toBe(`${from.description} stray`);
  expect(await descriptionOf(page, `/api/tickets/${to.key}`)).toBe(to.description);
});

for (const [kind, testId, Entity] of [
  ['projects', 'project-description', 'Project'],
  ['apps', 'app-description', 'App'],
] as const) {
  test(`text typed into a ${Entity} reaches that ${Entity} when history leaves with the caret in it (GF-76)`, async ({ page }) => {
    const owner = kind === 'projects' ? { app_id: (await post<Named>(page, '/api/apps', { name: `Typeroam ${Entity} owner` })).id } : {};
    const first = await post<Named>(page, `/api/${kind}`, { name: `Typeroam ${Entity} first`, description: 'first words', ...owner });
    const second = await post<Named>(page, `/api/${kind}`, { name: `Typeroam ${Entity} second`, description: 'second words', ...owner });
    await onFirstWithBothCached(page, kind, first, second);
    await typeInto(page, testId);
    await page.goForward();
    await expectTitle(page, second.name);
    await expect.poll(() => descriptionOf(page, `/api/${kind}/${first.id}`)).toBe('first words stray');
    expect(await descriptionOf(page, `/api/${kind}/${second.id}`)).toBe('second words');
  });
}

test('an open palette does not follow history to the next Ticket (GF-76)', async ({ page }) => {
  const app = await post<Named>(page, '/api/apps', { name: 'Palroam app' });
  const { to } = await onBlockedTicketWithBothCached(page, 'Palroam');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('palette').getByLabel('command palette').fill('move to app');
  await page.keyboard.press('Enter');
  await page.getByTestId('palette').getByLabel('command palette').fill(app.name);
  await page.goForward();
  await expectTitle(page, to.title);
  await expect(page.getByTestId('palette')).toHaveCount(0);
});
