import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * An open question and a Ticket that changes under it (GF-116): an agent in the terminal beside the
 * browser is the usual way, and coming back to the window is what brings the read. Every surface
 * that asks is here: the Ticket view's, the board's by press and by drop, and the Selection bar's.
 * Named to run late: the earlier specs count tickets and address keys by name.
 */

type Ticket = { key: string };

let appId = 0;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/apps', { data: { name: `Stale ${Date.now().toString(36)}` } });
  appId = ((await response.json()) as { id: number }).id;
});

/** Coined per run: `q` is a substring match over everything the earlier specs left behind. */
const RUN = `Qs${Date.now().toString(36)}`;
const coin = (name: string) => `${RUN} ${name}`;

const seed = async (page: Page, title: string, fields: object = {}) => {
  const response = await page.request.post('/api/tickets', { data: { title, app_id: appId, simple: true, ...fields } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Ticket;
};
const block = async (page: Page, blocked: Ticket, blocker: Ticket) => {
  expect((await page.request.post(`/api/tickets/${blocked.key}/dependencies`, { data: { blocker: blocker.key } })).ok()).toBe(true);
};
/** What an agent beside the browser does. */
const unblock = async (page: Page, blocked: Ticket, blocker: Ticket) => {
  expect((await page.request.delete(`/api/tickets/${blocked.key}/dependencies/${blocker.key}`)).ok()).toBe(true);
};
const move = async (page: Page, ticket: Ticket, verb: string) => {
  const response = await page.request.post(`/api/tickets/${ticket.key}/${verb}`);
  expect(response.ok(), await response.text()).toBe(true);
};
const eventsOf = async (page: Page, ticket: Ticket) => ((await (await page.request.get(`/api/tickets/${ticket.key}/events`)).json()) as unknown[]).length;
const trash = async (page: Page, ticket: Ticket) => {
  expect((await page.request.delete(`/api/tickets/${ticket.key}`)).ok()).toBe(true);
};

async function heldTicket(page: Page, name: string) {
  const blocker = await seed(page, coin(`${name} holdup`));
  const held = await seed(page, coin(`${name} held`), { status: 'ready' });
  await block(page, held, blocker);
  return { blocker, held };
}

/** Coming back to the window, repeated until the read lands, since a refocus only refetches past staleTime. */
async function comeBackUntil(page: Page, landed: (page: Page) => Promise<void>) {
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await landed(page);
  }).toPass({ timeout: 8_000 });
}
const quickly = { timeout: 300 };

const cardOf = (page: Page, ticket: Ticket) => page.getByTestId(`card-${ticket.key}`);

test.describe('the Ticket view', () => {
  async function asked(page: Page, name: string) {
    const made = await heldTicket(page, name);
    await page.goto(`/tickets/${made.held.key}`);
    await page.getByTestId('move-start').click();
    await expect(page.getByTestId('confirm-start')).toHaveText(new RegExp(`${made.blocker.key} still blocks this`));
    return made;
  }

  test('a cleared blocker closes the question and says so, a ⏎ meant for leave it only lets the line go, and start no longer asks', async ({ page }) => {
    const { blocker, held } = await asked(page, 'Tvcleared');
    await unblock(page, held, blocker);
    await comeBackUntil(page, (p) => expect(p.getByTestId('state-blocked')).toHaveCount(0, quickly));

    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
    await expect(page.getByTestId('confirm-start-gone')).toHaveText('nothing blocks this now');
    await expect(page.getByTestId('confirm-start-gone')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('confirm-start-gone')).toHaveCount(0);
    await expect(page.getByTestId('start-modal')).toHaveCount(0);
    await expect(page.getByTestId('move-start')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('start-modal')).toBeVisible();
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  });

  test('esc takes the line that is left, not the page', async ({ page }) => {
    const { blocker, held } = await asked(page, 'Tvesc');
    await unblock(page, held, blocker);
    await comeBackUntil(page, (p) => expect(p.getByTestId('confirm-start-gone')).toBeVisible(quickly));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confirm-start-gone')).toHaveCount(0);
    await expect(page).toHaveURL(`/tickets/${held.key}`);
  });

  test('the line holds the question’s seat in its tile, so nothing below it comes up under the pointer until it goes', async ({ page }) => {
    // within the tile: the desk packs its tiles again when the dependencies tile shrinks, which moves the whole tile a few pixels
    const belowTop = () =>
      page.evaluate(() => {
        const top = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top;
        return top('move-cancel') - top('state-tile');
      });
    const { blocker, held } = await asked(page, 'Tvseat');
    const second = await seed(page, coin('Tvseat second'));
    await block(page, held, second);
    await comeBackUntil(page, (p) => expect(p.getByTestId('confirm-start')).toContainText(second.key, quickly));
    const before = await belowTop();

    await unblock(page, held, blocker);
    await unblock(page, held, second);
    await comeBackUntil(page, (p) => expect(p.getByTestId('confirm-start-gone')).toBeVisible(quickly));
    expect(Math.abs((await belowTop()) - before)).toBeLessThan(1);
  });

  test('a Ticket gone to building closes the question, and a ⏎ meant for leave it writes nothing and goes nowhere', async ({ page }) => {
    const { held } = await asked(page, 'Tvmoved');
    await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();
    await move(page, held, 'start');
    await comeBackUntil(page, (p) => expect(p.getByTestId('move-stop')).toBeVisible(quickly));

    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
    await expect(page.getByTestId('confirm-start-gone')).toHaveText(`${held.key} moved to building`);
    const before = await eventsOf(page, held);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await eventsOf(page, held)).toBe(before);
    await expect(page).toHaveURL(`/tickets/${held.key}`);
    await expect(page.getByTestId('start-modal')).toHaveCount(0);
  });

  test('a closed question does not come back with the blocker', async ({ page }) => {
    const { blocker, held } = await asked(page, 'Tvback');
    await unblock(page, held, blocker);
    await comeBackUntil(page, (p) => expect(p.getByTestId('confirm-start-gone')).toBeVisible(quickly));

    await block(page, held, blocker);
    await comeBackUntil(page, (p) => expect(p.getByTestId('state-blocked')).toBeVisible(quickly));
    // past the line's own lifetime, because while it stands it would hide a question that had come back
    await expect(page.getByTestId('confirm-start-gone')).toHaveCount(0, { timeout: 6_000 });
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
  });

  test('a press of your own under the question says nothing about it', async ({ page }) => {
    await asked(page, 'Tvown');
    await page.getByTestId('move-cancel').click();
    await expect(page.getByTestId('state-tile')).toContainText('cancelled');
    await expect(page.getByTestId('confirm-start')).toHaveCount(0);
    await expect(page.getByTestId('confirm-start-gone')).toHaveCount(0);
  });

  test('an answer the read has not caught up with reaches the Start modal, and the API refuses it there in words', async ({ page }) => {
    const { held } = await asked(page, 'Tvbehind');
    await move(page, held, 'start');
    await page.getByTestId('confirm-start-yes').click();
    await page.getByTestId('start-plain').click();
    await expect(page.getByTestId('start-modal').getByRole('alert')).toContainText('building');
  });

  test('a new blocker redraws the sentence and leaves the focus where it is', async ({ page }) => {
    const { blocker, held } = await asked(page, 'Tvmore');
    await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();
    const second = await seed(page, coin('Tvmore second'));
    await block(page, held, second);
    await comeBackUntil(page, (p) => expect(p.getByTestId('confirm-start')).toContainText(`${blocker.key} and ${second.key} still block this`, quickly));
    await expect(page.getByTestId('confirm-start-dismiss')).toBeFocused();
  });
});

test.describe('the board', () => {
  /** By key, so the question sits under the card, as `s` and the card's menu both put it. */
  async function asked(page: Page, name: string) {
    const made = await heldTicket(page, name);
    await page.goto(`/?q=${encodeURIComponent(coin(`${name} held`))}`);
    await expect(cardOf(page, made.held)).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('confirm-ready')).toHaveText(new RegExp(`${made.blocker.key} still blocks this`));
    return made;
  }

  test('a cleared blocker closes the question, and start no longer asks', async ({ page }) => {
    const { blocker, held } = await asked(page, 'Bdcleared');
    await unblock(page, held, blocker);
    await comeBackUntil(page, (p) => expect(cardOf(p, held)).not.toContainText('◇', quickly));

    await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
    await expect(page.getByTestId('confirm-ready-gone')).toHaveText('nothing blocks this now');
    await expect(page.getByTestId('confirm-ready-gone')).toBeFocused();
    const url = page.url();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('confirm-ready-gone')).toHaveCount(0);
    expect(page.url()).toBe(url);
    await page.keyboard.press('s');
    await expect(page.getByTestId('run-move-start')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('start-modal')).toBeVisible();
    await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
  });

  test('a Ticket gone to building closes the question, and the line stays in the column it was asked in', async ({ page }) => {
    const { held } = await asked(page, 'Bdmoved');
    await move(page, held, 'start');
    await comeBackUntil(page, (p) => expect(p.getByTestId('col-building')).toContainText(held.key, quickly));

    await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
    await expect(page.getByTestId('col-ready').getByTestId('confirm-ready-gone')).toHaveText(`${held.key} moved to building`);
    await expect(page.getByTestId('start-modal')).toHaveCount(0);
  });

  test('a Ticket trashed under the question closes it', async ({ page }) => {
    const { held } = await asked(page, 'Bdtrashed');
    await trash(page, held);
    await comeBackUntil(page, (p) => expect(cardOf(p, held)).toHaveCount(0, quickly));
    await expect(page.getByTestId('confirm-ready')).toHaveCount(0);
    await expect(page.getByTestId('confirm-ready-gone')).toHaveText(`${held.key} has left this board`);
  });

  test('a new blocker redraws the sentence and leaves the focus where it is', async ({ page }) => {
    const { blocker, held } = await asked(page, 'Bdmore');
    await expect(page.getByTestId('confirm-ready-dismiss')).toBeFocused();
    const second = await seed(page, coin('Bdmore second'));
    await block(page, held, second);
    await comeBackUntil(page, (p) => expect(p.getByTestId('confirm-ready')).toContainText(`${blocker.key} and ${second.key} still block this`, quickly));
    await expect(page.getByTestId('confirm-ready-dismiss')).toBeFocused();
  });

  test('the answer opens the Start modal on the Ticket as it stands now, not as it was when the question was asked', async ({ page }) => {
    const { held } = await asked(page, 'Bdtitle');
    const title = coin('Bdtitle held, retitled');
    expect((await page.request.patch(`/api/tickets/${held.key}`, { data: { title } })).ok()).toBe(true);
    await comeBackUntil(page, (p) => expect(cardOf(p, held)).toContainText('retitled', quickly));

    await expect(page.getByTestId('confirm-ready')).toBeVisible();
    await page.getByTestId('confirm-ready-yes').click();
    await expect(page.getByTestId('start-modal')).toContainText(title);
  });

  test('an answer the read has not caught up with reaches the Start modal, and the API refuses it there in words', async ({ page }) => {
    const { held } = await asked(page, 'Bdbehind');
    await move(page, held, 'start');
    await page.getByTestId('confirm-ready-yes').click();
    await page.getByTestId('start-plain').click();
    await expect(page.getByTestId('start-modal').getByRole('alert')).toContainText('building');
  });

  test('a question asked by a drop closes too', async ({ page }) => {
    const { blocker, held } = await heldTicket(page, 'Bddrop');
    await page.goto(`/?q=${encodeURIComponent(coin('Bddrop held'))}`);
    await cardOf(page, held).dragTo(page.getByTestId('col-building'));
    await expect(page.getByTestId('confirm-building')).toContainText(`${blocker.key} still blocks this`);

    await unblock(page, held, blocker);
    await comeBackUntil(page, (p) => expect(cardOf(p, held)).not.toContainText('◇', quickly));
    await expect(page.getByTestId('confirm-building')).toHaveCount(0);
    await expect(page.getByTestId('col-ready')).toContainText(held.key);
  });
});

test.describe('the Selection bar', () => {
  const question = (page: Page): Locator => page.getByTestId('bulk-confirm');

  async function askedToStart(page: Page, name: string) {
    const first = await heldTicket(page, `${name} one`);
    const second = await heldTicket(page, `${name} two`);
    await page.goto(`/?q=${encodeURIComponent(coin(`${name} `))}`);
    await expect(cardOf(page, first.held)).toBeVisible();
    await page.getByTestId(`select-${first.held.key}`).check();
    await page.getByTestId(`select-${second.held.key}`).check();
    await page.getByTestId('bulk-status').click();
    await page.getByTestId('palette').getByTestId('run-move-start').click();
    await expect(question(page)).toContainText('2 Tickets of 2 still have open blockers');
    return { first, second };
  }

  test('one blocker cleared redraws the question from what is left, and the last withdraws it', async ({ page }) => {
    const { first, second } = await askedToStart(page, 'Barcleared');
    await unblock(page, first.held, first.blocker);
    await comeBackUntil(page, (p) => expect(question(p)).toContainText('1 Ticket of 2 still has open blockers', quickly));
    await expect(page.getByTestId('bulk-confirm-lines')).toHaveText(`${second.held.key} is blocked by ${second.blocker.key}`);

    await unblock(page, second.held, second.blocker);
    await comeBackUntil(page, (p) => expect(question(p)).toHaveCount(0, quickly));
    await expect(page.getByTestId('bulk-approve')).toBeVisible();
    await expect(page.getByTestId('bulk-refused')).toContainText('nothing blocks these now');
    await expect(page.getByTestId('bulk-dismiss')).toBeFocused();

    // esc takes the line, and only then the Selection
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-refused')).toHaveCount(0);
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  });

  test('a member gone to building withdraws the question and says why in that member’s words', async ({ page }) => {
    const { first } = await askedToStart(page, 'Barmoved');
    await move(page, first.held, 'start');
    await comeBackUntil(page, (p) => expect(question(p)).toHaveCount(0, quickly));
    await expect(page.getByTestId('selection-bar')).toContainText(first.held.key);
    await expect(page.getByTestId('selection-bar')).toContainText('building');
  });

  test('a member trashed under the question withdraws it, because it was about exactly those Tickets', async ({ page }) => {
    const a = await seed(page, coin('Bartrash a'));
    const b = await seed(page, coin('Bartrash b'));
    await page.goto(`/?q=${encodeURIComponent(coin('Bartrash '))}`);
    await expect(cardOf(page, a)).toBeVisible();
    await page.getByTestId(`select-${a.key}`).check();
    await page.getByTestId(`select-${b.key}`).check();
    await page.getByTestId('bulk-trash').click();
    await expect(question(page)).toContainText('Trash 2 Tickets?');

    await trash(page, a);
    await comeBackUntil(page, (p) => expect(cardOf(p, a)).toHaveCount(0, quickly));
    await expect(question(page)).toHaveCount(0);
    await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
    await expect(page.getByTestId('bulk-refused')).toContainText('the Selection changed');
    await expect(page.getByTestId('bulk-dismiss')).toBeFocused();
  });
});
