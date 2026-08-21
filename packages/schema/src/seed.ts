import { connect } from './sql.ts';
import { newId } from './ids.ts';
import { STANDARD_PRESET, STATUS_KINDS } from './types.ts';

const NAMES: Record<string, [string, string]> = {
  backlog:          ['Backlog',          '#5B6578'],
  ready_for_design: ['Ready for Design', '#B86E00'],
  designing:        ['Designing',        '#6146D6'],
  design_review:    ['Design Review',    '#B86E00'],
  ready_for_dev:    ['Ready for Dev',    '#1F4FD8'],
  building:         ['Building',         '#6146D6'],
  in_review:        ['In Review',        '#6146D6'],
  ready_to_merge:   ['Ready to Merge',   '#B86E00'],
  deploying:        ['Deploying',        '#6146D6'],
  done:             ['Done',             '#1E8E5A'],
  canceled:         ['Canceled',         '#C8323C'],
};

const sql = connect();

const [existing] = await sql<{ id: string }[]>`select id from project where slug = 'goblin-foundry'`;
if (existing) {
  console.log(`project already seeded: ${existing.id}`);
} else {
  const projectId = newId('prj');
  // 'goblin-foundry' derives 'GF'; the factory's own tickets have been FAC-
  // since day one, so the key is overridden rather than derived here too.
  await sql`insert into project (id, slug, key, name, repo_path, repo_remote, default_branch, policy) values (
    ${projectId}, 'goblin-foundry', 'FAC', 'Goblin Foundry', '/Users/roze/dev/factory',
    null, 'main', ${sql.json(STANDARD_PRESET as never)})`;

  const statusIds: Record<string, string> = {};
  for (const [i, kind] of STATUS_KINDS.entries()) {
    const id = newId('sts');
    statusIds[kind] = id;
    const [name, color] = NAMES[kind]!;
    await sql`insert into status (id, project_id, kind, name, color, sort_order, enabled)
      values (${id}, ${projectId}, ${kind}, ${name}, ${color}, ${i}, true)`;
  }

  const tickets = [
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
  console.log(`seeded project ${projectId} with ${STATUS_KINDS.length} statuses and ${tickets.length} tickets`);
}

await sql.end();
