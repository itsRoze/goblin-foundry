import { connect } from '@goblin/schema/sql';

type Listener = (runId: string) => void;

const listeners = new Set<Listener>();
let connecting = false;
let connected = false;

/**
 * One LISTEN connection for the whole process, fanned out in memory.
 * If it fails or drops, retry with backoff — a dead listener is invisible from
 * the browser's side, where a run just looks quiet forever.
 */
export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  void ensureListening();
  return () => listeners.delete(fn);
}

async function ensureListening(attempt = 0): Promise<void> {
  if (connected || connecting) return;
  connecting = true;
  const sql = connect();
  try {
    await sql.listen(
      'goblin_event',
      runId => { for (const l of listeners) l(runId); },
      () => { connected = true; },
    );
  } catch (e) {
    connecting = false;
    connected = false;
    await sql.end().catch(() => {});
    const delay = Math.min(30_000, 500 * 2 ** attempt);
    console.error(`goblin_event listener failed, retrying in ${delay}ms:`, (e as Error).message);
    setTimeout(() => { void ensureListening(attempt + 1); }, delay).unref();
    return;
  }
  connecting = false;
  connected = true;
}
