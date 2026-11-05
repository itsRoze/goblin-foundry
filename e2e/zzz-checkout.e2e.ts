import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Named to run after the desktop specs, whose app lists this App would crowd. */
test.describe("an App's Checkout", () => {
  let root: string;
  let repo: string;

  test.beforeAll(() => {
    // real, because git answers with where a folder actually is and macOS's temp dir is a symlink
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gf-e2e-checkout-')));
    repo = join(root, 'subway-reader');
    mkdirSync(join(repo, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
  });
  test.afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('set, refused and cleared from the App view, from the keyboard', async ({ page }) => {
    const app = (await (await page.request.post('/api/apps', { data: { name: 'Subway Writer', repository_url: 'https://example.com/r', default_branch: 'main' } })).json()) as { id: number };
    await page.goto(`/apps/subway-writer-${app.id}`);
    const about = page.getByTestId('about-tile');
    const fact = (name: string) => about.locator('.gf-kv-row').filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}$`) }) }).locator('dd');
    const shown = fact('checkout');
    await expect(shown).toHaveText('—');
    // beside what it answers to: where the product lives in the world, then where it lives here
    await expect(about.locator('.gf-kv-row dt')).toHaveText(['name', 'repository', 'branch', 'checkout', 'description']);

    await page.getByRole('button', { name: 'edit app' }).focus();
    await page.keyboard.press('Enter');
    const form = page.getByTestId('edit-form');
    const field = form.getByLabel('checkout');
    // name is focused on open; repository and branch come before it
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    await expect(field).toBeFocused();

    // a typo is refused where it was typed, with the field named the way the screen names it
    const typo = join(root, 'typo');
    await page.keyboard.type(typo);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(form.getByRole('alert')).toHaveText(`checkout: no folder at ${typo}`);
    await expect(field).toHaveAttribute('aria-invalid', 'true');

    // `save` keeps the focus through a refusal, so `esc` is still the form's and the typed words are not walked off with
    const save = form.getByRole('button', { name: /save/ });
    await save.click();
    await expect(form.getByRole('alert')).toHaveText(`checkout: no folder at ${typo}`);
    await expect(save).toBeFocused();

    // a folder inside the repository comes back as the repository
    await field.fill(join(repo, 'src'));
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(form).toBeHidden();
    await expect(shown).toHaveText(repo);
    await expect(page.getByTestId('history').locator('li').first()).toContainText(`checkout set to ${repo}`);
    await expect(page.getByRole('button', { name: 'edit app' })).toBeFocused();

    // the edit opens on what is recorded, and emptying it clears it
    await page.getByRole('button', { name: 'edit app' }).click();
    await expect(field).toHaveValue(repo);
    await field.fill('');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(form).toBeHidden();
    await expect(shown).toHaveText('—');
    await expect(page.getByTestId('history').locator('li').first()).toContainText('checkout set and cleared');

    // and the edit left the remote and branch where they were
    await expect(fact('repository')).toHaveText('https://example.com/r');
    await expect(fact('branch')).toHaveText('main');
    expect(((await (await page.request.get(`/api/apps/${app.id}`)).json()) as { checkout: string | null }).checkout).toBeNull();
  });
});
