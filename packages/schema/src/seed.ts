import { connect } from './sql.ts';
import { createProject } from './project.ts';
import { newId } from './ids.ts';
import type { StatusKind } from './types.ts';

const sql = connect();

const [existing] = await sql<{ id: string }[]>`select id from project where slug = 'goblin-foundry'`;
if (existing) {
  console.log(`project already seeded: ${existing.id}`);
} else {
  // The factory's own tickets have been FAC- since day one; deriveProjectKey()
  // alone would give 'GF' (deriveProjectKey.test.ts covers that derivation),
  // so the override here is the literal migration overrides for the row that
  // already exists in older DBs — unconditional, not contingent on whatever
  // deriveProjectKey happens to return.
  const { projectId, key, statusIds } = await createProject(sql, {
    slug: 'goblin-foundry',
    name: 'Goblin Foundry',
    repoPath: '/Users/roze/dev/factory',
    key: 'FAC',
  });

  const tickets: { shortId: number; title: string; body: string; status: StatusKind; type: string }[] = [
    { shortId: 1, title: 'API exposes /healthz with version and uptime',
      body: 'The factory API should answer GET /healthz with JSON: status, version from package.json, uptime seconds, and whether Postgres is reachable. Used by the worker to decide whether the API is up before claiming work.',
      status: 'ready_for_design', type: 'feature' },
    { shortId: 2, title: 'Board supports j/k keyboard navigation',
      body: 'Moving between cards on the board with j/k, and opening the focused card with Enter, the way zbugs and Linear do.',
      status: 'backlog', type: 'feature' },
  ];
  for (const t of tickets) {
    await sql`insert into ticket (id, project_id, short_id, title, body, type, status_id, assignee)
      values (${newId('tkt')}, ${projectId}, ${t.shortId}, ${t.title}, ${t.body}, ${t.type},
              ${statusIds[t.status]!}, 'roze')`;
  }
  console.log(`seeded project ${projectId} (${key}) with ${Object.keys(statusIds).length} statuses and ${tickets.length} tickets`);
}

await sql.end();
