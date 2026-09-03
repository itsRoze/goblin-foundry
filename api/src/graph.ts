/**
 * The Project view's dependency graph, in one query set: every live,
 * non-cancelled ticket in the project, plus the direct other end of every edge
 * that crosses the project boundary — one hop, never the chain beyond it.
 *
 * What is *not* here is half the point. A Trashed thing is hidden everywhere
 * and a `cancelled` one blocks nothing and is waited on by nothing
 * (CONTEXT.md), so both go together with their edges: a chain
 * A → C(cancelled) → B draws A and B with no edge between them, which is
 * accurate rather than a gap. Every other declared edge is drawn, satisfied
 * ones included (ADR-0009: an edge is a durable fact).
 */
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { descriptionLine, isOpenBlocker, ticketKey, type GraphEdge, type GraphNode, type ProjectGraph, type TicketStatus } from '@goblin/shared';
import type { Db } from './db';
import { batches } from './dependencies';
import { app as appTable, dependency, project as projectTable, ticket as ticketTable } from './schema';
import { readSettings } from './settings';

/** `id → name` for the handful of apps or projects the external ends point at; batched, per ADR-0001. */
async function namesOf(db: Db, table: typeof appTable | typeof projectTable, ids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  for (const batch of batches(ids))
    for (const row of await db.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, batch))) names.set(row.id, row.name);
  return names;
}

/** One end of an edge, joined under its own alias. Named so the union below can say "either table" in a type. */
const endOfEdge = (name: string) => alias(ticketTable, name);
type TicketTable = typeof ticketTable | ReturnType<typeof endOfEdge>;

interface NodeRow {
  id: number;
  title: string;
  status: TicketStatus;
  description: string;
  app_id: number | null;
  project_id: number | null;
}

/** The columns a node is built from, whichever side of the boundary the ticket is on. */
const nodeColumns = (t: TicketTable) => ({ id: t.id, title: t.title, status: t.status, description: t.description, app_id: t.app_id, project_id: t.project_id });

/** Drawn at all: not in the trash, and not `cancelled`. */
const drawable = (t: TicketTable) => and(isNull(t.trashed_at), ne(t.status, 'cancelled'));

export async function projectGraph(db: Db, projectId: number): Promise<ProjectGraph> {
  const { ticket_prefix: prefix } = await readSettings(db);
  const key = (row: NodeRow) => ticketKey(prefix, row.id);

  const mine: NodeRow[] = await db
    .select(nodeColumns(ticketTable))
    .from(ticketTable)
    .where(and(eq(ticketTable.project_id, projectId), drawable(ticketTable)))
    .orderBy(asc(ticketTable.id));

  // both ends of every edge that touches the project, so the externals arrive with the edges that reach them
  const blockerT = endOfEdge('blocker_end');
  const blockedT = endOfEdge('blocked_end');
  const declared = await db
    .select({ blocker: nodeColumns(blockerT), blocked: nodeColumns(blockedT) })
    .from(dependency)
    .innerJoin(blockerT, eq(blockerT.id, dependency.blocker_id))
    .innerJoin(blockedT, eq(blockedT.id, dependency.blocked_id))
    .where(and(or(eq(blockerT.project_id, projectId), eq(blockedT.project_id, projectId)), drawable(blockerT), drawable(blockedT)))
    .orderBy(asc(blockerT.id), asc(blockedT.id));

  const edges: GraphEdge[] = [];
  const outside = new Map<number, NodeRow>();
  /** Only the blockers still in the way, in blocker order — the same derived condition the rest of the app shows. */
  const blockedBy = new Map<number, string[]>();
  for (const { blocker, blocked } of declared) {
    edges.push({ blocker: key(blocker), blocked: key(blocked) });
    for (const end of [blocker, blocked]) if (end.project_id !== projectId) outside.set(end.id, end);
    if (blocked.project_id === projectId && isOpenBlocker(blocker.status)) blockedBy.set(blocked.id, [...(blockedBy.get(blocked.id) ?? []), key(blocker)]);
  }

  const externals = [...outside.values()];
  const idsOf = (field: 'app_id' | 'project_id') => [...new Set(externals.map((row) => row[field]).filter((id): id is number => id !== null))];
  const appNames = await namesOf(db, appTable, idsOf('app_id'));
  const projectNames = await namesOf(db, projectTable, idsOf('project_id'));

  const node = (row: NodeRow, external?: GraphNode['external']): GraphNode => ({
    key: key(row),
    title: row.title,
    status: row.status,
    // an external's own blockers are behind the boundary, and one hop means this drawing does not speak for them
    blocked_by: external ? [] : (blockedBy.get(row.id) ?? []),
    description_line: descriptionLine(row.description),
    ...(external ? { external } : {}),
  });
  const where = (row: NodeRow): GraphNode['external'] => ({
    app: row.app_id === null ? null : (appNames.get(row.app_id) ?? null),
    project: row.project_id === null ? null : (projectNames.get(row.project_id) ?? null),
  });

  const nodes = [...mine.map((row) => [row.id, node(row)] as const), ...externals.map((row) => [row.id, node(row, where(row))] as const)]
    .sort(([a], [b]) => a - b)
    .map(([, n]) => n);
  return { nodes, edges };
}
