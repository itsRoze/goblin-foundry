#!/usr/bin/env bun
/**
 * `docs/tickets/` is the hand-written S1 plan, kept as history; new work lives in Goblin
 * (CLAUDE.md). A file added there is work the tracker never sees, so the set of files is
 * frozen at the commit that last added one. Editing an existing file stays allowed.
 */
import { $ } from 'bun';

const FROZEN_AT = '3fe922196c7750dd2bfb189547054e2954c177b7';
const DIR = 'docs/tickets';

const lines = (out: string) => out.split('\n').filter(Boolean);

// `git ls-files -- <path>` resolves the path against the working directory.
process.chdir((await $`git rev-parse --show-toplevel`.text()).trim());

if ((await $`git cat-file -e ${FROZEN_AT}^{commit}`.nothrow().quiet()).exitCode !== 0) {
  console.error(`frozen-tickets: commit ${FROZEN_AT} is missing; fetch the full history (a shallow clone lacks it)`);
  process.exit(1);
}

const frozen = new Set(lines(await $`git ls-tree -r --name-only ${FROZEN_AT} -- ${DIR}`.text()));
const now = lines(await $`git ls-files --cached --others --exclude-standard -- ${DIR}`.text());
const added = now.filter((path) => !frozen.has(path));

if (added.length > 0) {
  console.error(`frozen-tickets: ${DIR}/ is history and takes no new files:`);
  for (const path of added) console.error(`  ${path}`);
  console.error('File the work in Goblin instead: see "When a skill says \\"publish to the issue tracker\\"" in docs/agents/issue-tracker.md.');
  process.exit(1);
}
