import { chromium, webkit } from '@playwright/test';
import { matrix, withoutMarkers, wordsLost } from '../e2e/paste-matrix';

/**
 * Every paste shape at every place in a field, in the real editor in a real browser, and whether the
 * words reached what is stored and what a read of it holds (GF-106). About four minutes an engine, so
 * it is not in CI: `e2e/zz-paste-words.e2e.ts` is the part that is.
 *
 *   bun scripts/paste-matrix.ts chromium && bun scripts/paste-matrix.ts webkit   # failures: .scratch/paste-matrix-<engine>.json
 */

const ENGINES = { chromium, webkit };
const BATCH = 500;

const built = await Bun.build({ entrypoints: [new URL('../web/test/paste-matrix-page.tsx', import.meta.url).pathname], target: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
if (!built.success) throw new AggregateError(built.logs, 'the page did not build');
const script = await built.outputs[0]!.text();

const alphanumerics = (text: string) => text.match(/[\p{L}\p{N}]/gu) ?? [];
/** Whether the characters of `host` are all in `read`, in order, however a paste split them. */
const holdsInOrder = (read: string, host: string) => {
  const left = alphanumerics(host);
  for (const character of alphanumerics(read)) if (character === left[0]) left.shift();
  return left.length === 0;
};
const rows = matrix();
const name = process.argv[2] as keyof typeof ENGINES;
if (!(name in ENGINES)) throw new Error('name an engine: chromium or webkit');

const browser = await ENGINES[name].launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
await page.addScriptTag({ content: script });
const failures = [];
let threw = 0;
let lost = 0;
let hostLost = 0;
for (let at = 0; at < rows.length; at += BATCH) {
  const batch = rows.slice(at, at + BATCH);
  const results = await page.evaluate((rows) => window.pasteRows(rows), batch);
  results.forEach(({ before, stored, reread, errors }, i) => {
    const row = batch[i]!;
    const words = [...new Set([...wordsLost(row.paste, stored), ...wordsLost(row.paste, reread)])];
    // only a selection is meant to take any of the host's words away, and a list renumbers around what lands in it
    const hostGone = !row.place.startsWith('over') && !holdsInOrder(reread, withoutMarkers(before));
    threw += errors.length > 0 ? 1 : 0;
    lost += words.length > 0 ? 1 : 0;
    hostLost += hostGone ? 1 : 0;
    if (errors.length > 0 || words.length > 0 || hostGone) failures.push({ ...row, words, hostGone, stored, reread, errors });
  });
}
await browser.close();
console.log(`${name}: ${rows.length} pastes, ${threw} threw, ${lost} lost words, ${hostLost} lost the host's words`);
await Bun.write(`.scratch/paste-matrix-${name}.json`, JSON.stringify(failures, null, 1));
process.exit(failures.length > 0 ? 1 : 0);
