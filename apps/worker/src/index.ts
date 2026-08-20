import { hostname } from 'node:os';
import * as db from './db.ts';
import { sweepStalledRuns } from './reaper.ts';
import { runPipeline } from './sequencer.ts';

const ONCE = process.argv.includes('--once');
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const HEARTBEAT_MS = 20_000;

async function tick(): Promise<boolean> {
  // Close out anything a dead worker left running before taking new work.
  await sweepStalledRuns(hostname(), process.pid).catch(e => console.error('reaper', e));

  const claim = await db.claim('ready_for_dev', hostname(), process.pid);
  if (!claim) return false;

  console.log(`claimed FAC-${claim.shortId} "${claim.title}" as ${claim.runId}`);
  const beat = setInterval(() => { void db.heartbeat(claim.runId).catch(() => {}); }, HEARTBEAT_MS);
  try {
    const outcome = await runPipeline(claim);
    console.log(`FAC-${claim.shortId} → ${outcome}`);
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
