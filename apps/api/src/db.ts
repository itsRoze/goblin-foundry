import { connect, type Sql } from '@goblin/schema/sql';
import { newId, formatRef, parseRef, resolveRef, TRIGGER_STAGES, type StatusKind } from '@goblin/schema';

export const sql: Sql = connect();

export type TicketRow = {
  id: string; project_id: string; project_key: string; short_id: number; title: string; body: string;
  type: string; status_id: string; status_kind: StatusKind; status_name: string;
  priority: number; assignee: string | null; delegate: string | null;
  project_slug: string; repo_path: string; default_branch: string; policy: unknown;
};

const TICKET_COLUMNS = sql`
  t.*, p.key as project_key, s.kind as status_kind, s.name as status_name,
  p.slug as project_slug, p.repo_path, p.default_branch, p.policy`;

/** A bare short id more than one project has: the caller has to ask, not guess. */
export class AmbiguousTicketRefError extends Error {
  constructor(public readonly candidates: TicketRow[]) {
    super(`ticket number matches more than one project: ${candidates.map(r => formatRef(r.project_key, r.short_id)).join(', ')}`);
  }
}

/** Look a ticket up by id, by canonical ref (`FAC-12`), or by a bare short id
    — which resolves only when exactly one project has it. `resolveRef` is the
    one place that ambiguity is decided; this only fetches its candidates. */
export async function getTicket(ref: string): Promise<TicketRow | undefined> {
  const parsed = parseRef(ref);
  const bare = /^#?(\d+)$/.exec(ref.trim());

  if (!parsed && !bare) {
    // Not a ref at all — the only other shape a caller passes is an internal id.
    const [row] = await sql<TicketRow[]>`
      select ${TICKET_COLUMNS} from ticket t
      join status s on s.id = t.status_id
      join project p on p.id = t.project_id
      where t.id = ${ref}`;
    return row;
  }

  const rows = await sql<TicketRow[]>`
    select ${TICKET_COLUMNS} from ticket t
    join status s on s.id = t.status_id
    join project p on p.id = t.project_id
    where ${parsed
      ? sql`upper(p.key) = ${parsed.key} and t.short_id = ${parsed.shortId}`
      : sql`t.short_id = ${Number(bare![1])}`}`;

  const resolution = resolveRef(ref, rows.map(row => ({ key: row.project_key, shortId: row.short_id, row })));
  if (resolution.status === 'unique') return resolution.candidate.row;
  if (resolution.status === 'ambiguous') throw new AmbiguousTicketRefError(resolution.candidates.map(c => c.row));
  return undefined;
}

export type TicketLookup =
  | { ok: true; ticket: TicketRow }
  | { ok: false; status: 404 | 409; body: { error: string } };

/** The Hono-facing wrapper: turns the ambiguity error into a response body
    instead of a thrown exception every route would have to catch itself. */
export async function findTicket(ref: string): Promise<TicketLookup> {
  try {
    const ticket = await getTicket(ref);
    return ticket ? { ok: true, ticket } : { ok: false, status: 404, body: { error: 'not found' } };
  } catch (e) {
    if (e instanceof AmbiguousTicketRefError) return { ok: false, status: 409, body: { error: e.message } };
    throw e;
  }
}

export async function statusIdFor(projectId: string, kind: StatusKind): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from status where project_id = ${projectId} and kind = ${kind}`;
  if (!row) throw new Error(`project ${projectId} has no status of kind ${kind}`);
  return row.id;
}

export async function moveTicket(ticketId: string, projectId: string, kind: StatusKind) {
  const statusId = await statusIdFor(projectId, kind);
  await sql`update ticket set status_id = ${statusId}, updated_at = now() where id = ${ticketId}`;
  return statusId;
}

export async function nextDesignVersion(ticketId: string): Promise<number> {
  const [row] = await sql<{ max: number | null }[]>`
    select max(version) as max from design where ticket_id = ${ticketId}`;
  return (row?.max ?? 0) + 1;
}

export async function createDesign(
  ticketId: string, markdown: string, reviewHtml: string | null, createdBy: string,
) {
  const version = await nextDesignVersion(ticketId);
  const id = newId('dsg');
  await sql`update design set status = 'superseded'
            where ticket_id = ${ticketId} and status in ('draft','in_review')`;
  await sql`insert into design (id, ticket_id, version, status, markdown, review_html, created_by)
            values (${id}, ${ticketId}, ${version}, 'in_review', ${markdown}, ${reviewHtml}, ${createdBy})`;
  return { id, version };
}

// ── Round answers, dismissal and stuck retry: the inbox's action endpoints ──
// Each is one transaction with an explicit guard, per design.md's "Acting on
// an item" — a multi-request action can half-succeed and leave a ticket
// unreachable.

export type AnswerRoundResult =
  | { ok: true; answered: number }
  | { ok: false; status: 409; body: { error: string } };

/**
 * Every answer in the round, together. A question that already carries the
 * identical answer is not an error — a retry after a dropped connection
 * completes the round instead of failing on the first already-answered
 * question — but a question that landed with a *different* answer since is a
 * genuine conflict.
 */
export async function answerRound(
  answers: { questionId: string; answer: string }[], answeredBy: string,
): Promise<AnswerRoundResult> {
  return sql.begin(async tx => {
    for (const a of answers) {
      await tx`update question set answer = ${a.answer}, answered_by = ${answeredBy}, answered_at = now()
                where id = ${a.questionId} and answered_at is null`;
    }
    const ids = answers.map(a => a.questionId);
    const rows = await tx<{ id: string; answer: string | null }[]>`
      select id, answer from question where id in ${tx(ids)}`;
    const mismatched = answers.filter(a => rows.find(r => r.id === a.questionId)?.answer !== a.answer);
    if (mismatched.length) {
      return { ok: false, status: 409,
        body: { error: 'this round has already moved on — some answers no longer match' } } as const;
    }
    return { ok: true, answered: answers.length } as const;
  });
}

export type DismissResult =
  | { ok: true; closed: number }
  | { ok: false; status: 409; body: { error: string } };

/**
 * Closes every open question in a round, in words that read as a dismissal
 * rather than an answer — `answer` stays null, `answered_by` carries the
 * "(dismissed)" marker. Refuses if the round's run has not actually ended: a
 * live worker is polling those rows and would consume a dismissal as if it
 * were a considered answer.
 */
export async function dismissRound(phaseId: string, dismissedBy: string): Promise<DismissResult> {
  return sql.begin(async tx => {
    const [phase] = await tx<{ id: string; run_id: string | null }[]>`
      select id, run_id from phase where id = ${phaseId}`;
    if (!phase) return { ok: false, status: 409, body: { error: 'this round no longer exists' } } as const;

    const [run] = phase.run_id
      ? await tx<{ id: string; status: string; ticket_id: string }[]>`
          select id, status, ticket_id from run where id = ${phase.run_id} for update`
      : [];
    if (!run) return { ok: false, status: 409, body: { error: 'this round no longer exists' } } as const;
    if (run.status !== 'success' && run.status !== 'fail' && run.status !== 'canceled') {
      return { ok: false, status: 409,
        body: { error: 'this round is not stale — its run is still live' } } as const;
    }

    const closed = await tx<{ id: string }[]>`
      update question set answered_at = now(), answered_by = ${`${dismissedBy} (dismissed)`}
      where phase_id = ${phaseId} and answered_at is null
      returning id`;
    await tx`update ticket set delegate = null, updated_at = now() where id = ${run.ticket_id}`;

    return { ok: true, closed: closed.length } as const;
  });
}

export type RetryDestination = 'trigger' | 'backlog';
export type RetryResult =
  | { ok: true; status: StatusKind; requeued: boolean }
  | { ok: false; status: 409; body: { error: string } };

/**
 * One transaction: sets the ticket to the status kind its run was claimed
 * from (or Backlog), clears its delegate, touches it so the worker's
 * anti-reclaim guard (a failed run's `ended_at` compared to the ticket's
 * `updated_at`) lets it be claimed again, and closes any open questions left
 * behind by that ticket's ended runs. Refuses if the worker has already
 * re-claimed the ticket since the caller decided it was stuck.
 */
export async function retryStuckTicket(ticketId: string, destination: RetryDestination): Promise<RetryResult> {
  return sql.begin(async tx => {
    const [ticket] = await tx<{ id: string; project_id: string; status_kind: StatusKind }[]>`
      select t.id, t.project_id, s.kind as status_kind
      from ticket t join status s on s.id = t.status_id
      where t.id = ${ticketId}
      for update of t`;
    if (!ticket) return { ok: false, status: 409, body: { error: 'ticket not found' } } as const;

    const [run] = await tx<{ id: string; status: string; trigger: StatusKind }[]>`
      select id, status, trigger from run where ticket_id = ${ticket.id}
      order by started_at desc limit 1`;
    const stage = run ? TRIGGER_STAGES[run.trigger] : undefined;
    const stillStuck = run && (run.status === 'fail' || run.status === 'canceled')
      && stage && ticket.status_kind === stage.working;
    if (!stillStuck) {
      return { ok: false, status: 409, body: { error: 'this ticket is running again' } } as const;
    }

    const targetKind: StatusKind = destination === 'backlog' ? 'backlog' : run.trigger;
    const [targetStatus] = await tx<{ id: string }[]>`
      select id from status where project_id = ${ticket.project_id} and kind = ${targetKind}`;
    if (!targetStatus) {
      return { ok: false, status: 409, body: { error: `this project has no ${targetKind} status` } } as const;
    }

    await tx`update ticket set status_id = ${targetStatus.id}, delegate = null, updated_at = now()
              where id = ${ticket.id}`;
    await tx`update question set answered_at = now(), answered_by = 'system (retried)'
              where answered_at is null
                and run_id in (select id from run where ticket_id = ${ticket.id} and status in ('fail','canceled'))`;

    return { ok: true, status: targetKind, requeued: destination === 'trigger' && targetKind === ticket.status_kind } as const;
  });
}

export type EventRow = {
  id: string; run_id: string; phase_id: string | null; parent_id: string | null;
  type: string; name: string; payload: unknown; tokens: number | null;
  started_at: string; ended_at: string | null;
};

/** The live tail and the history are the same query — only the cursor differs. */
export async function eventsAfter(runId: string, cursor: string, limit = 500): Promise<EventRow[]> {
  return await sql<EventRow[]>`
    select id::text, run_id, phase_id, parent_id::text, type, name, payload, tokens::int,
           started_at, ended_at
    from event where run_id = ${runId} and id > ${cursor}::bigint
    order by id limit ${limit}`;
}
