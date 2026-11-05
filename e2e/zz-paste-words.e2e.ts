import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { TiptapEditorHTMLElement } from '@tiptap/core';
import { wordsLost, type Place } from './paste-matrix';

/**
 * A paste keeps every word of the clipboard's text (GF-106), in what is stored and in what a
 * reload shows, with no page error. A small part of the matrix in `paste-matrix.ts`, through the
 * real app and server, in both engines: `scripts/paste-matrix.ts` runs the rest. Named to run after
 * the desktop specs, whose palette rows these apps would crowd.
 */

type Surface = 'ticket' | 'app';

/** Each row is a route a paste has lost words by, on `main` or on an earlier attempt at this fix. */
const ROWS: [Surface, string, Exclude<Place, 'over all'>, string][] = [
  ['ticket', '', 'start', '- # one'],
  ['ticket', 'hello world', 'middle', '**`one`** and [`two`](http://three.y)'],
  ['ticket', 'hello world', 'end', '# Plan\n\n| step | owner |\n|---|---|\n| one | two |\n\nthe rest'],
  ['ticket', '- aa\n- bb', 'start', '```\none\n```'],
  ['ticket', 'hello world', 'over part', 'See the [guide][g].\n\n[g]: http://x.y/guide'],
  ['ticket', '```\ncode\n```', 'middle', '<!-- one -->\n\n- [x] two'],
  ['app', 'hello world', 'end', 'Docs: http://x.y/name/value\n    | name | value |\n    |------|-------|'],
  ['app', 'hello world', 'middle', 'see http://secret.y now\n    | secret |\n    |---|'],
  ['app', '**bold** rest', 'start', '- a\n  - | secret |\n    |---|\n\n<secret>'],
  ['app', '', 'start', '```\n<secret>\n1. beta\n```\n[secret]: #'],
  ['app', 'hello world', 'over part', '> - # one\n\ntwo  \nthree'],
  ['ticket', '', 'start', '1. a\n2. b\n\n| 1 | 2 |\n|---|---|'],
  ['app', '', 'start', '| 🇺🇸 | → | ✓ | ★ | € |\n|---|---|---|---|---|'],
  ['app', 'hello world', 'over part', '\tone. '],
];

async function surfaceHolding(page: Page, surface: Surface, body: string) {
  const name = `Paste ${Date.now()}${Math.random()}`;
  const made = await page.request.post(surface === 'ticket' ? '/api/tickets' : '/api/apps', { data: surface === 'ticket' ? { title: name, description: body } : { name, description: body } });
  const { key, id } = (await made.json()) as { key: string; id: number };
  return surface === 'ticket' ? { url: `/tickets/${key}`, path: `/api/tickets/${key}`, testId: 'description' } : { url: `/apps/${id}`, path: `/api/apps/${id}`, testId: 'app-description' };
}

for (const [surface, host, place, paste] of ROWS) {
  test(`${JSON.stringify(paste)} pasted (${place}) into ${JSON.stringify(host)} in a ${surface} keeps its words (GF-106)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { url, path, testId } = await surfaceHolding(page, surface, host);
    await page.goto(url);
    const field = page.getByTestId(testId).locator('.gf-doc');
    await expect(field).toBeVisible();
    await field.evaluate(
      (element: TiptapEditorHTMLElement, { place, paste }) => {
        const editor = element.editor!;
        const { doc } = editor.state;
        let first: [number, number] = [1, 1];
        doc.descendants((node, pos) => {
          if (first[1] === 1 && node.isTextblock && node.content.size > 0) first = [pos + 1, pos + 1 + node.content.size];
        });
        const space = doc.textBetween(...first).indexOf(' ');
        if (place === 'start') editor.commands.setTextSelection(first[0]);
        if (place === 'middle') editor.commands.setTextSelection(Math.floor((first[0] + first[1]) / 2));
        if (place === 'end') editor.commands.setTextSelection(doc.content.size);
        if (place === 'over part') editor.commands.setTextSelection({ from: first[0] + space + 1, to: first[1] });
        element.focus();
        const data = new DataTransfer();
        data.setData('text/plain', paste);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      },
      { place, paste },
    );
    await page.getByTestId('page-title').click();
    const stored = async () => ((await (await page.request.get(path)).json()) as { description: string | null }).description ?? '';
    await expect.poll(async () => wordsLost(paste, await stored())).toEqual([]);

    await page.reload();
    await expect(field).toBeVisible();
    // what a reload shows: a parser that drops a table from the stored body drops it here
    const shown = await field.evaluate((element: HTMLElement) => [element.innerText, ...[...element.querySelectorAll('a')].filter((a) => !a.href.includes(a.innerText)).map((a) => `${a.href} ${a.title}`)].join('\n'));
    expect(wordsLost(paste, shown, 'shown')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
