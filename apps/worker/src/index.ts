import { hostname } from 'node:os';
import { formatRef } from '@goblin/schema';
import * as db from './db.ts';
import { TRIGGER_PIPELINES } from './pipelines.ts';
import { sweepStalledRuns } from './reaper.ts';
import { runPipeline } from './sequencer.ts';

// The api and the worker are both `tsx src/index.ts`, so anything matching on
// the command line finds the wrong one. A name of its own is what `just ps`
// and `just stop` look for.
process.title = 'goblin-worker';

const ONCE = process.argv.includes('--once');
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const HEARTBEAT_MS = 20_000;

async function tick(): Promise<boolean> {
  // Close out anything a dead worker left running before taking new work.
  await sweepStalledRuns(hostname(), process.pid).catch(e => console.error('reaper', e));

  // Trigger statuses in declaration order: a design waiting to be written is
  // worth starting before the next build, because you are the one it waits for.
  let claim: db.Claim | undefined;
  for (const [trigger, pipeline] of Object.entries(TRIGGER_PIPELINES)) {
    claim = await db.claim(trigger, hostname(), process.pid, pipeline!.working, pipeline!.delegate);
    if (claim) break;
  }
  if (!claim) return false;

  const ref = formatRef(claim.projectKey, claim.shortId);
  console.log(`claimed ${ref} "${claim.title}" from ${claim.trigger} as ${claim.runId}`);
  const beat = setInterval(() => { void db.heartbeat(claim.runId).catch(() => {}); }, HEARTBEAT_MS);
  try {
    const outcome = await runPipeline(claim);
    console.log(`${ref} → ${outcome}`);
  } finally {
    clearInterval(beat);
  }
  return true;
}

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

console.log(`goblin worker awake${ONCE ? ' (single claim)' : ''}`);
do {
  const worked = await tick();
  if (ONCE) break;
  if (!worked) await new Promise(r => setTimeout(r, POLL_MS));
} while (!stopping);

await db.sql.end();
