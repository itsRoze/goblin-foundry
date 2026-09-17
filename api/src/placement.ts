/**
 * Where a Ticket may live and what moving it may not break — asked the same
 * way by a single edit and by a bulk move (issue 03b), which is why it is not
 * inside either route.
 */
import { eq } from 'drizzle-orm';
import { approveGuard, guardHold, isGuarded, type ApproveRequirement, type GuardFields } from '@goblin/shared';
import type { Db } from './db';
import type { Issue } from './problems';
import { app as appTable, project as projectTable, type TicketRow } from './schema';


/** Where a ticket lives. `app_id` is stored as well as `project_id` so the board's commonest filter needs no join (ADR-0007). */
export interface Placement {
  app_id: number | null;
  project_id: number | null;
}

const loadApp = async (db: Db, id: number) => (await db.select().from(appTable).where(eq(appTable.id, id)))[0];
const loadProject = async (db: Db, id: number) => (await db.select().from(projectTable).where(eq(projectTable.id, id)))[0];

/** A trashed or archived App or Project is not somewhere a live ticket may point; each refusal says which it is. */
function unavailable(kind: 'app' | 'project', id: number, row: { trashed_at: string | null; archived_at: string | null } | undefined): Issue | null {
  const message = !row ? 'not found' : row.trashed_at ? 'is in the trash' : row.archived_at ? 'is archived' : null;
  return message === null ? null : { path: [`${kind}_id`], message: `${kind} ${id} ${message}` };
}

/**
 * ADR-0007 in one place, for create and patch alike: picking a Project sets
 * the App, a contradicting `app_id` in the same body is refused, and moving
 * the App away from the Project's App drops the Project.
 */
export async function resolvePlacement(db: Db, current: Placement, body: { app_id?: number | null; project_id?: number | null }): Promise<Placement | Issue[]> {
  if (body.project_id !== undefined && body.project_id !== null) {
    const project = await loadProject(db, body.project_id);
    const issue = unavailable('project', body.project_id, project);
    if (issue || !project) return [issue ?? { path: ['project_id'], message: `project ${body.project_id} not found` }];
    if (body.app_id !== undefined && body.app_id !== project.app_id)
      return [{ path: ['app_id'], message: `project ${project.id} belongs to ${project.app_id === null ? 'no app' : `app ${project.app_id}`}` }];
    return { app_id: project.app_id, project_id: project.id };
  }

  const project_id = body.project_id === null ? null : current.project_id;
  if (body.app_id === undefined) return { app_id: current.app_id, project_id };
  if (body.app_id !== null) {
    const issue = unavailable('app', body.app_id, await loadApp(db, body.app_id));
    if (issue) return [issue];
  }
  if (project_id === null) return { app_id: body.app_id, project_id };
  const project = await loadProject(db, project_id);
  return { app_id: body.app_id, project_id: project?.app_id === body.app_id ? project_id : null };
}

/** Which field a missing requirement is the fault of, so the 422 points somewhere the GUI can highlight. */
const BLAMED: Record<ApproveRequirement, 'app_id' | 'design'> = { app: 'app_id', design: 'design' };

/**
 * A ticket at `ready` or beyond must go on satisfying the guard, so an edit
 * that would break it is refused rather than silently dropping the ticket out
 * of the frontier (ADR-0003). Only newly missing requirements count: a patch
 * is never blamed for something that was already absent.
 */
export function wouldBreakGuard(row: TicketRow, next: GuardFields, body: { simple?: boolean }): Issue[] {
  if (!isGuarded(row.status)) return [];
  const before = new Set(approveGuard(row));
  return approveGuard(next)
    .filter((requirement) => !before.has(requirement))
    .map((requirement) => ({
      // un-flagging `simple` is what took the design away, so that is the field to name
      path: [requirement === 'design' && body.simple === false ? 'simple' : BLAMED[requirement]],
      message: `${guardHold(row.status, [requirement])} — unapprove it first`,
    }));
}

