import { sql, event } from './db.ts';

/**
 * Close out runs whose worker died.
 *
 * A claimed ticket sits in `building`, so nothing re-claims it and nothing
 * notices: the run says `running` forever, with a heartbeat that stopped and a
 * pid that is gone. The lease cannot help — `claim()` only ever looks at tickets
 * in a trigger status. This is the sweep that makes a killed worker recoverable.
 */

/** A ticket that has failed this many times stops being requeued and waits for you. */
const MAX_STALL_REQUEUES = 3;

type Stalled = {
  id: string; ticket_id: string; project_id: string; worktree: string | null;
  trigger: string; host: string | null; pid: number | null; idle_min: number; stall_min: number;
};

export async function sweepStalledRuns(host: string, pid: number): Promise<number> {
  const stalled = await sql<Stalled[]>`
    select r.id, r.ticket_id, r.project_id, r.worktree, r.trigger, r.host, r.pid,
           round(extract(epoch from (now() - r.heartbeat_at)) / 60) as idle_min,
           coalesce((p.policy->'budgets'->>'stallTimeoutMin')::int, 30) as stall_min
    from run r
    join project p on p.id = r.project_id
    -- A run parked on a question still heartbeats, so it is only swept here
    -- once the worker driving it is genuinely gone.
    where r.status in ('running','awaiting_input')
      and r.heartbeat_at is not null
      and r.heartbeat_at < now() - make_interval(
            mins => coalesce((p.policy->'budgets'->>'stallTimeoutMin')::int, 30))
      -- never reap a run this process is still driving
      and not (r.host is not distinct from ${host} and r.pid is not distinct from ${pid})`;

  for (const run of stalled) {
    await sql.begin(async tx => {
      await tx`update run set status = 'fail', terminal_reason = 'stalled',
               ended_at = now(), lease_expires_at = null where id = ${run.id}`;
      await tx`update phase set status = 'fail', error = 'stalled', ended_at = now()
               where run_id = ${run.id} and status in ('running','queued','awaiting_input')`;
    });

    await event({
      runId: run.id, type: 'error', name: 'stalled',
      payload: {
        idle_minutes: run.idle_min, stall_timeout_min: run.stall_min,
        pid: run.pid, host: run.host, worktree: run.worktree,
        note: 'no heartbeat — the worker driving this run is gone',
      },
    });

    // Requeue a few times, then let it wait for a human. "3 retries, then escalate."
    const [failures] = await sql<{ count: number }[]>`
      select count(*)::int as count from run
      where ticket_id = ${run.ticket_id} and status = 'fail'`;
    const count = failures?.count ?? 0;
    if (count < MAX_STALL_REQUEUES) {
      // Back to the status it was claimed from, whatever that was.
      const [ready] = await sql<{ id: string }[]>`
        select id from status where project_id = ${run.project_id} and kind = ${run.trigger}`;
      if (ready) {
        await sql`update ticket set status_id = ${ready.id}, delegate = null, updated_at = now()
                  where id = ${run.ticket_id}`;
      }
    } else {
      await sql`update ticket set delegate = null, updated_at = now() where id = ${run.ticket_id}`;
    }
    console.log(`reaped ${run.id}: idle ${run.idle_min}m, ${count < MAX_STALL_REQUEUES ? 'requeued' : 'left for you'}`);
  }

  return stalled.length;
}
