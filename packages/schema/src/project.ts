import type { Sql } from './sql.ts';
import { newId } from './ids.ts';
import { deriveProjectKey, formatRef } from './ref.ts';
import { STATUS_DISPLAY } from './status.ts';
import { POLICY_PRESETS, type Policy } from './policy.ts';
import { STATUS_KINDS, type StatusKind } from './types.ts';

export type ProjectCreate = {
  id?: string;
  slug: string;
  name: string;
  repoPath: string;
  repoRemote?: string | null;
  defaultBranch?: string;
  policy?: Policy;
  key?: string; // override derived key (factory project uses FAC)
};

export type CreatedProject = {
  projectId: string;
  key: string;
  slug: string;
  statusIds: Record<StatusKind, string>;
};

/**
 * Create a project plus its canonical status rows in one project.
 * Callers that already hold a transaction should pass `tx`.
 */
export async function createProject(
  sql: Sql,
  spec: ProjectCreate,
): Promise<CreatedProject> {
  const db = sql;
  const existingKeys = (await db<{ key: string }[]>`select key from project`).map(r => r.key);
  const key = spec.key ?? deriveProjectKey(spec.slug, existingKeys);
  const projectId = spec.id ?? newId('prj');
  const policy = spec.policy ?? POLICY_PRESETS.standard;

  await db`insert into project (id, slug, key, name, repo_path, repo_remote, default_branch, policy) values (
    ${projectId}, ${spec.slug}, ${key}, ${spec.name}, ${spec.repoPath},
    ${spec.repoRemote ?? null}, ${spec.defaultBranch ?? 'main'}, ${db.json(policy as never)})`;

  const statusIds: Record<StatusKind, string> = {} as Record<StatusKind, string>;
  for (const [i, kind] of STATUS_KINDS.entries()) {
    const id = newId('sts');
    statusIds[kind] = id;
    const [name, color] = STATUS_DISPLAY[kind]!;
    await db`insert into status (id, project_id, kind, name, color, sort_order, enabled)
      values (${id}, ${projectId}, ${kind}, ${name}, ${color}, ${i}, true)`;
  }

  return { projectId, key, slug: spec.slug, statusIds };
}

/** Format a ticket ref for this project, kept here so callers do not re-import ref.ts separately. */
export { formatRef };
