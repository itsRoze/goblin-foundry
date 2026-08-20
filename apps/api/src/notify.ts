import { connect } from '@goblin/schema/sql';

type Listener = (runId: string) => void;

const listeners = new Set<Listener>();
let started: Promise<void> | undefined;

/** One LISTEN connection for the whole process, fanned out in memory. */
export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  started ??= (async () => {
    const sql = connect();
    await sql.listen('goblin_event', runId => {
      for (const l of listeners) l(runId);
    });
  })();
  void started;
  return () => listeners.delete(fn);
}
