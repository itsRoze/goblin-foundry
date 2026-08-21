import { connect, type Sql } from '@goblin/schema/sql';
import { newId, parseRef, type StatusKind } from '@goblin/schema';

export const sql: Sql = connect();

export type TicketRow = {
  id: string; project_id: string; project_key: string; short_id: number; title: string; body: string;
  type: string; status_id: string; status_kind: StatusKind; status_name: string;
  priority: number; assignee: string | null; delegate: string | null;
  project_slug: string; repo_path: string; default_branch: string; policy: unknown;
};

/** A bare short id more than one project has: the caller has to ask, not guess. */
export class AmbiguousTicketRefError extends Error {
  constructor(public readonly candidates: TicketRow[]) {
    super(`ticket number matches more than one project: ${candidates.map(r => `${r.project_key}-${r.short_id}`).join(', ')}`);
  }
}

/** Look a ticket up by id, by canonical ref (`FAC-12`), or by a bare short id
    — which resolves only when exactly one project has it. */
export async function getTicket(ref: string): Promise<TicketRow | undefined> {
  const parsed = parseRef(ref);
  const bare = Number(ref.replace(/^#/, ''));
  const rows = await sql<TicketRow[]>`
    select t.*, p.key as project_key, s.kind as status_kind, s.name as status_name,
           p.slug as project_slug, p.repo_path, p.default_branch, p.policy
    from ticket t
    join status s on s.id = t.status_id
    join project p on p.id = t.project_id
    where t.id = ${ref}
      ${parsed ? sql`or (upper(p.key) = ${parsed.key} and t.short_id = ${parsed.shortId})` : sql``}
      ${!parsed && Number.isFinite(bare) ? sql`or t.short_id = ${bare}` : sql``}`;
  if (rows.length <= 1) return rows[0];
  // A canonical ref and an id are unique by construction; only a bare short
  // id shared by more than one project can land here.
  throw new AmbiguousTicketRefError(rows);
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
