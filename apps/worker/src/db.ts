import { connect, type Sql } from '@goblin/schema/sql';
import { newId, type EventType, type GateReport, type Policy } from '@goblin/schema';

export const sql: Sql = connect();

export type Claim = {
  runId: string; ticketId: string; projectId: string; shortId: number;
  title: string; body: string; repoPath: string; defaultBranch: string;
  policy: Policy; designId: string | null; designMarkdown: string | null;
};

const LEASE_MS = 2 * 60_000;

/**
 * Atomically take one ticket sitting in a trigger status and open a run for it.
 * `FOR UPDATE SKIP LOCKED` plus a lease is what lets a second worker exist later.
 */
export async function claim(kind: string, host: string, pid: number): Promise<Claim | undefined> {
  return sql.begin(async tx => {
    const [row] = await tx<{
      ticket_id: string; project_id: string; short_id: number; title: string; body: string;
      repo_path: string; default_branch: string; policy: Policy;
      design_id: string | null; design_markdown: string | null;
    }[]>`
      select t.id as ticket_id, t.project_id, t.short_id, t.title, t.body,
             p.repo_path, p.default_branch, p.policy,
             d.id as design_id, d.markdown as design_markdown
      from ticket t
      join status s on s.id = t.status_id
      join project p on p.id = t.project_id
      left join lateral (
        select id, markdown from design
        where ticket_id = t.id and status = 'approved'
        order by version desc limit 1
      ) d on true
      where s.kind = ${kind}
        and not exists (
          select 1 from run r where r.ticket_id = t.id
            and r.status in ('running','queued','awaiting_input')
            and (r.lease_expires_at is null or r.lease_expires_at > now()))
      order by t.priority, t.short_id
      limit 1
      for update of t skip locked`;
    if (!row) return undefined;

    const runId = newId('run');
    await tx`insert into run (id, ticket_id, project_id, design_id, trigger, status,
                              lease_expires_at, heartbeat_at, pid, host)
             values (${runId}, ${row.ticket_id}, ${row.project_id}, ${row.design_id}, ${kind},
                     'running', now() + ${`${LEASE_MS} milliseconds`}::interval, now(), ${pid}, ${host})`;
    const [building] = await tx<{ id: string }[]>`
      select id from status where project_id = ${row.project_id} and kind = 'building'`;
    if (building) {
      await tx`update ticket set status_id = ${building.id}, delegate = 'builder', updated_at = now()
               where id = ${row.ticket_id}`;
    }
    return {
      runId, ticketId: row.ticket_id, projectId: row.project_id, shortId: row.short_id,
      title: row.title, body: row.body, repoPath: row.repo_path,
      defaultBranch: row.default_branch, policy: row.policy,
      designId: row.design_id, designMarkdown: row.design_markdown,
    };
  });
}

export async function heartbeat(runId: string) {
  await sql`update run set heartbeat_at = now(),
            lease_expires_at = now() + ${`${LEASE_MS} milliseconds`}::interval
            where id = ${runId}`;
}

export async function setRunBranch(runId: string, worktree: string, branch: string) {
  await sql`update run set worktree = ${worktree}, branch = ${branch} where id = ${runId}`;
}

export async function finishRun(
  runId: string, status: 'success' | 'fail' | 'canceled', terminalReason: string,
) {
  await sql`update run set status = ${status}, terminal_reason = ${terminalReason},
            ended_at = now(), lease_expires_at = null where id = ${runId}`;
}

export type Usage = {
  costUsd: number; inputTokens: number; outputTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; numTurns: number;
};

export async function addRunCost(runId: string, u: Usage) {
  await sql`update run set cost_usd = cost_usd + ${u.costUsd},
            input_tokens = input_tokens + ${u.inputTokens},
            output_tokens = output_tokens + ${u.outputTokens},
            cache_read_tokens = cache_read_tokens + ${u.cacheReadTokens},
            cache_write_tokens = cache_write_tokens + ${u.cacheWriteTokens}
            where id = ${runId}`;
}

export async function startPhase(
  runId: string, seq: number, kind: 'agent' | 'code' | 'human', name: string,
  agent: string | null, model: string | null, effort: string | null,
) {
  const id = newId('phs');
  await sql`insert into phase (id, run_id, seq, kind, name, agent, model, effort, status, started_at)
            values (${id}, ${runId}, ${seq}, ${kind}, ${name}, ${agent}, ${model}, ${effort},
                    'running', now())`;
  return id;
}

export async function updatePhase(phaseId: string, fields: {
  sessionId?: string; attempt?: number; status?: string; error?: string | null; usage?: Usage;
}) {
  if (fields.sessionId !== undefined) {
    await sql`update phase set session_id = ${fields.sessionId} where id = ${phaseId}`;
  }
  if (fields.attempt !== undefined) {
    await sql`update phase set attempt = ${fields.attempt} where id = ${phaseId}`;
  }
  if (fields.usage) {
    const u = fields.usage;
    await sql`update phase set cost_usd = cost_usd + ${u.costUsd},
              input_tokens = input_tokens + ${u.inputTokens},
              output_tokens = output_tokens + ${u.outputTokens},
              cache_read_tokens = cache_read_tokens + ${u.cacheReadTokens},
              cache_write_tokens = cache_write_tokens + ${u.cacheWriteTokens},
              num_turns = num_turns + ${u.numTurns}
              where id = ${phaseId}`;
  }
  if (fields.status !== undefined) {
    await sql`update phase set status = ${fields.status}, error = ${fields.error ?? null},
              ended_at = case when ${fields.status} in ('success','fail') then now() else ended_at end
              where id = ${phaseId}`;
  }
}

export async function event(e: {
  runId: string; phaseId?: string | null; type: EventType; name?: string;
  payload?: unknown; tokens?: number | null; startedAt?: Date; endedAt?: Date | null;
}) {
  const [row] = await sql<{ id: string }[]>`
    insert into event (run_id, phase_id, type, name, payload, tokens, started_at, ended_at)
    values (${e.runId}, ${e.phaseId ?? null}, ${e.type}, ${e.name ?? ''},
            ${sql.json((e.payload ?? {}) as never)}, ${e.tokens ?? null},
            ${e.startedAt ?? new Date()}, ${e.endedAt ?? null})
    returning id::text`;
  return row!.id;
}

export async function endToolEvent(eventId: string, payload: unknown, endedAt: Date) {
  await sql`update event set payload = ${sql.json(payload as never)}, ended_at = ${endedAt}
            where id = ${eventId}::bigint`;
}

export async function saveEnvelope(
  phaseId: string, agent: string, outputType: string,
  payload: unknown, valid: boolean, attempt: number, raw: string | null,
) {
  await sql`insert into envelope (id, phase_id, agent, output_type, payload, raw, valid, attempt)
            values (${newId('env')}, ${phaseId}, ${agent}, ${outputType},
                    ${sql.json((payload ?? {}) as never)}, ${raw}, ${valid}, ${attempt})`;
}

export async function saveGate(phaseId: string, attempt: number, r: GateReport) {
  await sql`insert into gate (id, phase_id, attempt, gate, passed, checks)
            values (${newId('gat')}, ${phaseId}, ${attempt}, ${r.gate}, ${r.passed},
                    ${sql.json(r.checks as never)})`;
}

export async function moveTicket(
  ticketId: string, projectId: string, kind: string, delegate: string | null,
) {
  const [row] = await sql<{ id: string }[]>`
    select id from status where project_id = ${projectId} and kind = ${kind}`;
  if (!row) throw new Error(`no status of kind ${kind}`);
  await sql`update ticket set status_id = ${row.id}, delegate = ${delegate}, updated_at = now()
            where id = ${ticketId}`;
}

/** sessionStore mirror: one row per transcript entry, deduped on uuid. */
export async function appendTranscript(
  projectKey: string, sessionId: string, subpath: string, entries: unknown[],
) {
  for (const entry of entries) {
    const uuid = (entry as { uuid?: string }).uuid ?? null;
    await sql`insert into transcript_entry (project_key, session_id, subpath, uuid, entry)
              values (${projectKey}, ${sessionId}, ${subpath}, ${uuid}, ${sql.json(entry as never)})
              on conflict do nothing`;
  }
}

export async function loadTranscript(sessionId: string, subpath: string) {
  const rows = await sql<{ entry: unknown }[]>`
    select entry from transcript_entry
    where session_id = ${sessionId} and subpath = ${subpath} order by id`;
  return rows.length ? rows.map(r => r.entry) : null;
}
