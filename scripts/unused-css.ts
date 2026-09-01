#!/usr/bin/env bun
/**
 * Class names defined in CSS that nothing in the app uses.
 *
 * stylelint cannot answer this — it never sees the JSX — so the one check that
 * would have caught `.gf-row-kind` sitting dead in the stylesheet is this.
 * It errs towards calling a class used: a false "unused" would have someone
 * delete live styles, while a missed one is only a rule outliving its component
 * a while longer. The match stops at a class-name boundary so that `gf-rows`
 * does not vouch for `gf-row` — plain `includes` made every prefix of a longer
 * class permanently unreportable, which is most of the vocabulary.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `.pathname` is percent-encoded, so a repo path containing a space would break every read
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Styles that exist for a component that is not built yet; each needs a reason. */
const PLANNED: Record<string, string> = {
  'gf-breathe': 'the live-run ambient animation (DESIGN.md §7) — arrives with runs in S5',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|html)$/.test(name)) out.push(path);
  }
  return out;
}

const cssFiles = [join(ROOT, 'web/src/app.css'), join(ROOT, 'design/tokens.css')];
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
// `index.html` too — a class used only in the shell would otherwise read as dead
const source = [join(ROOT, 'web/index.html'), ...walk(join(ROOT, 'web/src')), ...walk(join(ROOT, 'e2e'))]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const defined = [...new Set([...css.matchAll(/\.(gf-[a-z0-9-]+)/g)].map((m) => m[1]!))].sort();
/** `gf-row` is used by `class="gf-row"`, but not by `class="gf-rows"`. */
const used = (c: string) => new RegExp(`${c}(?![a-z0-9-])`).test(source);
const unused = defined.filter((c) => !used(c));

const dead = unused.filter((c) => !(c in PLANNED));
const planned = unused.filter((c) => c in PLANNED);

for (const c of planned) console.log(`  · ${c} — kept: ${PLANNED[c]}`);
if (dead.length === 0) {
  console.log(`${defined.length} classes defined, all used.`);
  process.exit(0);
}
console.error(`\nUnused in the app (delete them, or add a reason to PLANNED in this script):`);
for (const c of dead) console.error(`  ✖ .${c}`);
process.exit(1);
