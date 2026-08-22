import { connect, type Sql } from '@goblin/schema/sql';
import { newId, type EventType, type GateReport, type Policy } from '@goblin/schema';

/**
 * Connects on first use, not on import.
 *
 * A module that touches the database used to open a connection the moment it
 * was imported, which meant importing anything near it — a pure helper, a tool
 * guard, a parser — needed a live Postgres. Three test files had to be split
 * apart to work around that. The handle is a proxy so every call site keeps
 * using it as a tagged template.
 */
let client: Sql | undefined;
const connection = (): Sql => (client ??= connect());

export const sql: Sql = new Proxy((() => undefined) as unknown as Sql, {
  apply: (_target, _thisArg, args: unknown[]) =>
    (connection() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, prop) => (connection() as unknown as Record<string | symbol, unknown>)[prop],
});

export type Claim = {
  runId: string; ticketId: string; projectId: string; projectKey: string; shortId: number;
  title: string; body: string; repoPath: string; defaultBranch: string;
  policy: Policy; designId: string | null; designMarkdown: string | null;
  /** What you wrote on the design before approving it — the builder reads these. */
  designNotes: { note?: string }[]; trigger: string;
};

const LEASE_MS = 2 * 60_000;

/**
 * Atomically take one ticket sitting in a trigger status and open a run for it.
 * `FOR UPDATE SKIP LOCKED` plus a lease is what lets a second worker exist later.
 */
export async function claim(
  kind: string, host: string, pid: number, working: string, delegate: string,
): Promise<Claim | undefined> {
  return sql.begin(async tx => {
    const [row] = await tx<{
      ticket_id: string; project_id: string; project_key: string; short_id: number; title: string; body: string;
      repo_path: string; default_branch: string; policy: Policy;
      design_id: string | null; design_markdown: string | null; design_notes: { note?: string }[] | null;
    }[]>`
      select t.id as ticket_id, t.project_id, p.key as project_key, t.short_id, t.title, t.body,
             p.repo_path, p.default_branch, p.policy,
             d.id as design_id, d.markdown as design_markdown, d.notes as design_notes
      from ticket t
      join status s on s.id = t.status_id
      join project p on p.id = t.project_id
      left join lateral (
        select id, markdown, notes from design
        where ticket_id = t.id and status = 'approved'
        order by version desc limit 1
      ) d on true
      where s.kind = ${kind}
        -- A pipeline whose ticket stays in its trigger status (review) would
        -- otherwise be re-claimed forever after a failure. Three attempts since
        -- you last touched the card, then it waits for you — the same "3 retries
        -- then escalate" the stall reaper uses. Moving the card bumps
        -- updated_at, which is how you say "try again".
        and (
          select count(*) from run r2 where r2.ticket_id = t.id and r2.trigger = ${kind}
            and r2.status = 'fail' and r2.ended_at > t.updated_at) < 3
        -- A ticket that just failed gets a minute to itself. Whatever defeats
        -- the attempt guard above still cannot spin: a loop needs speed.
        and not exists (
          select 1 from run r4 where r4.ticket_id = t.id and r4.status = 'fail'
            and r4.ended_at > now() - interval '60 seconds')
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
    // The ticket moves to the pipeline's working status — designing for the
    // planner, building for the builder — so nothing else claims it meanwhile.
    const [inProgress] = await tx<{ id: string }[]>`
      select id from status where project_id = ${row.project_id} and kind = ${working}`;
    if (inProgress) {
      await tx`update ticket set status_id = ${inProgress.id}, delegate = ${delegate}, updated_at = now()
               where id = ${row.ticket_id}`;
    }
    return {
      runId, ticketId: row.ticket_id, projectId: row.project_id, projectKey: row.project_key, shortId: row.short_id,
      title: row.title, body: row.body, repoPath: row.repo_path,
      defaultBranch: row.default_branch, policy: row.policy,
      designId: row.design_id, designMarkdown: row.design_markdown,
      designNotes: row.design_notes ?? [], trigger: kind,
    };
  });
}

/** Runs started in the last N minutes, across every ticket — the breaker's input. */
export async function recentRunCount(windowMin: number): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from run
    where started_at > now() - make_interval(mins => ${windowMin})`;
  return row?.count ?? 0;
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
  harness: string = 'claude-code',
) {
  const id = newId('phs');
  await sql`insert into phase (id, run_id, seq, kind, name, agent, model, effort, harness,
                               status, started_at)
            values (${id}, ${runId}, ${seq}, ${kind}, ${name}, ${agent}, ${model}, ${effort},
                    ${harness}, 'running', now())`;
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

/**
 * A finished run takes its goblin's name off the card. It deliberately does not
 * touch `updated_at`: that column is how a human says "try again", and a failing
 * run that bumps it re-arms its own claim. One that did looped 12,357 times.
 */
export async function clearDelegate(ticketId: string) {
  await sql`update ticket set delegate = null where id = ${ticketId}`;
}

// ── Questions: the seam where a run waits for you ────────────────────────────

export type QuestionRow = {
  id: string; run_id: string | null; phase_id: string; seq: number;
  header: string; prompt: string; options: unknown; multi_select: boolean;
  answer: string | null; answered_by: string | null;
  asked_at: string; answered_at: string | null;
};

export async function insertQuestion(q: {
  id: string; runId: string; phaseId: string; seq: number;
  header: string; prompt: string; options: unknown; multiSelect: boolean;
}) {
  await sql`insert into question (id, run_id, phase_id, seq, header, prompt, options, multi_select)
            values (${q.id}, ${q.runId}, ${q.phaseId}, ${q.seq}, ${q.header}, ${q.prompt},
                    ${sql.json((q.options ?? []) as never)}, ${q.multiSelect})`;
}

export async function questionsById(ids: string[]): Promise<QuestionRow[]> {
  if (!ids.length) return [];
  return sql<QuestionRow[]>`select * from question where id in ${sql(ids)} order by seq`;
}

/** A waiting run says so: the board shows it, and the reaper still sees a heartbeat. */
export async function setAwaitingInput(runId: string, phaseId: string, waiting: boolean) {
  const status = waiting ? 'awaiting_input' : 'running';
  await sql`update run set status = ${status} where id = ${runId} and status in ('running','awaiting_input')`;
  await sql`update phase set status = ${status} where id = ${phaseId} and status in ('running','awaiting_input')`;
}

// ── Designs: stored, never committed ─────────────────────────────────────────

/** The next version for this ticket, superseding any draft still in review. */
export async function createDesign(
  ticketId: string, markdown: string, reviewHtml: string | null, createdBy: string,
): Promise<{ id: string; version: number }> {
  const [row] = await sql<{ max: number | null }[]>`
    select max(version) as max from design where ticket_id = ${ticketId}`;
  const version = (row?.max ?? 0) + 1;
  const id = newId('dsg');
  await sql`update design set status = 'superseded'
            where ticket_id = ${ticketId} and status in ('draft','in_review')`;
  await sql`insert into design (id, ticket_id, version, status, markdown, review_html, created_by)
            values (${id}, ${ticketId}, ${version}, 'in_review', ${markdown}, ${reviewHtml}, ${createdBy})`;
  return { id, version };
}

export type PriorDesign = {
  id: string; version: number; status: string; markdown: string;
  notes: { at: string; note: string }[];
};

/** The last design of any status, with the annotations you left on it. */
export async function latestDesign(ticketId: string): Promise<PriorDesign | undefined> {
  const [row] = await sql<PriorDesign[]>`
    select id, version, status, markdown, notes from design
    where ticket_id = ${ticketId} order by version desc limit 1`;
  return row;
}

export async function setRunDesign(runId: string, designId: string) {
  await sql`update run set design_id = ${designId} where id = ${runId}`;
}

// ── Resuming an earlier agent ────────────────────────────────────────────────

/** The builder session that produced this ticket's branch, if it still exists. */
export async function lastBuilderSession(ticketId: string): Promise<string | null> {
  const [row] = await sql<{ session_id: string | null }[]>`
    select p.session_id from phase p
    join run r on r.id = p.run_id
    where r.ticket_id = ${ticketId} and p.agent = 'builder' and p.session_id is not null
    order by p.started_at desc limit 1`;
  return row?.session_id ?? null;
}

/** The next free phase number in a run — for phases a phase decides to open. */
export async function nextPhaseSeq(runId: string): Promise<number> {
  const [row] = await sql<{ max: number | null }[]>`
    select max(seq) as max from phase where run_id = ${runId}`;
  return (row?.max ?? 0) + 1;
}

/** Everything you have already been asked about this ticket, and said. */
export async function answeredQuestions(ticketId: string): Promise<
  { header: string; prompt: string; answer: string }[]
> {
  return sql<{ header: string; prompt: string; answer: string }[]>`
    select q.header, q.prompt, q.answer from question q
    join run r on r.id = q.run_id
    where r.ticket_id = ${ticketId} and q.answer is not null
    order by q.asked_at, q.seq`;
}

/** What this run has spent so far — the per-ticket budget is checked against it. */
export async function runCost(runId: string): Promise<number> {
  const [row] = await sql<{ cost_usd: number }[]>`select cost_usd from run where id = ${runId}`;
  return row?.cost_usd ?? 0;
}
