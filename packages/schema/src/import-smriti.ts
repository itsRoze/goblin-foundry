#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connect, migrate } from './sql.ts';
import { createProject } from './project.ts';
import { newId } from './ids.ts';
import type { Sql } from './sql.ts';
import {
  formatReport, mapSourceTickets, translateEdges, rewriteBodyReferences,
  type IdMapEntry, type ImportReport, type SourceDep, type SourceTicket, type TranslatedEdge,
} from './import.ts';

const TARGET_SLUG = 'subway-reader';
const TARGET_NAME = 'Subway Reader';
const REPO_PATH = '/Users/roze/dev/subway-reader';

function parseArgs(argv: string[]): { dryRun: boolean; sourcePath: string } {
  const flags = new Set(argv.filter(a => a.startsWith('-')));
  const dryRun = flags.has('--dry-run') || flags.has('-n');
  const positional = argv.filter(a => !a.startsWith('-'));
  const sourcePath = positional[0] ?? join(homedir(), '.smriti', 'factory.db');
  return { dryRun, sourcePath };
}

class DryRunAbort extends Error {
  constructor(public readonly report: ImportReport) {
    super('dry run');
  }
}

function openSource(path: string): { db: DatabaseSync; close: () => void } {
  const db = new DatabaseSync(path, { readOnly: true });
  return { db, close: () => { try { db.close(); } catch { /* ignore */ } } };
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? '';
}

function readyRefs(tickets: IdMapEntry[], edges: TranslatedEdge[]): string[] {
  const blocked = new Set(edges.map(e => e.blocked.ref));
  return tickets.filter(t => !blocked.has(t.ref)).map(t => t.ref);
}

async function buildReport(
  sql: Sql,
  dryRun: boolean,
  sourceDb: DatabaseSync,
): Promise<ImportReport> {
  const [projectRow] = sourceDb.prepare(
    'select id, name, description from projects where slug = ?',
  ).all(TARGET_SLUG) as { id: number; name: string; description: string | null }[];

  if (!projectRow) {
    throw new Error(`project '${TARGET_SLUG}' not found in source database`);
  }

  const projectId = projectRow.id;
  const sourceTickets = sourceDb.prepare(
    'select id, position, title, body from tickets where project_id = ? order by position, id',
  ).all(projectId) as SourceTicket[];

  const sourceDeps = sourceDb.prepare(
    'select blocker_id as blockerId, blocked_id as blockedId from ticket_deps '
    + 'where blocker_id in (select id from tickets where project_id = ?)',
  ).all(projectId) as SourceDep[];

  const rows = sourceDb.prepare(
    'select count(*) as count from documents where project_id = ?',
  ).all(projectId) as { count: number }[];
  const docCount = rows[0]?.count ?? 0;

  const [existing] = await sql<{ id: string; key: string }[]>`
    select id, key from project where slug = ${TARGET_SLUG}`;

  if (existing) {
    return {
      verdict: 'no-op',
      projectSlug: TARGET_SLUG,
      projectKey: existing.key,
      projectName: TARGET_NAME,
      designSize: (projectRow.description ?? '').length,
      designOpeningLine: firstLine(projectRow.description ?? ''),
      sourceTicketCount: sourceTickets.length,
      importedTicketCount: 0,
      sourceDepCount: sourceDeps.length,
      importedDepCount: 0,
      skippedDepCount: sourceDeps.length,
      skippedCategories: [
        { category: 'tickets', count: sourceTickets.length, reason: `project ${TARGET_SLUG} already exists` },
        { category: 'dependencies', count: sourceDeps.length, reason: `project ${TARGET_SLUG} already exists` },
        { category: 'documents', count: docCount, reason: 'documents are not imported by this ticket' },
      ],
      tickets: [],
      edges: [],
      rewrittenRefs: 0,
      readyTickets: [],
      deleteStatement: `delete from project where slug = '${TARGET_SLUG}';`,
    };
  }

  const { projectId: newProjectId, key } = await createProject(sql, {
    slug: TARGET_SLUG,
    name: TARGET_NAME,
    repoPath: REPO_PATH,
  });

  const designMarkdown = projectRow.description ?? '';
  await sql`insert into project_design (id, project_id, version, markdown)
            values (${newId('pjd')}, ${newProjectId}, 1, ${designMarkdown})`;

  const idMap = mapSourceTickets(sourceTickets, key);
  const orderedTickets = [...idMap.values()].sort((a, b) => a.shortId - b.shortId);

  const ticketDbIds = new Map<number, string>(); // shortId -> ticket uuid
  let rewrittenRefs = 0;
  const [backlogStatus] = await sql<{ id: string }[]>`
    select id from status where project_id = ${newProjectId} and kind = 'backlog'`;
  const backlogStatusId = backlogStatus!.id;

  for (const entry of orderedTickets) {
    const source = sourceTickets.find(t => t.id === entry.sourceId)!;
    const { body, rewritten } = rewriteBodyReferences(source.body ?? '', idMap);
    rewrittenRefs += rewritten;
    const ticketId = newId('tkt');
    ticketDbIds.set(entry.shortId, ticketId);
    await sql`insert into ticket (id, project_id, short_id, title, body, type, status_id, assignee)
              values (${ticketId}, ${newProjectId}, ${entry.shortId}, ${source.title}, ${body},
                      'feature', ${backlogStatusId}, 'roze')`;
  }

  const { edges, skipped } = translateEdges(sourceDeps, idMap);
  for (const e of edges) {
    const blockerId = ticketDbIds.get(e.blocker.shortId)!;
    const blockedId = ticketDbIds.get(e.blocked.shortId)!;
    await sql`insert into ticket_dep (blocker_id, blocked_id)
              values (${blockerId}, ${blockedId})`;
  }

  // Verification: read back the edges we just wrote and compare with the source set.
  const dbIds = [...ticketDbIds.values()];
  const written = await sql<{ blocker_id: string; blocked_id: string }[]>`
    select blocker_id, blocked_id from ticket_dep
    where blocker_id in ${sql(dbIds)} and blocked_id in ${sql(dbIds)}`;

  const sourceToDb = new Map<number, string>(); // source id -> db id
  for (const entry of orderedTickets) {
    sourceToDb.set(entry.sourceId, ticketDbIds.get(entry.shortId)!);
  }
  const dbToSource = new Map([...sourceToDb.entries()].map(([s, d]) => [d, s]));

  const writtenSet = new Set(written.map(r => `${dbToSource.get(r.blocker_id)}->${dbToSource.get(r.blocked_id)}`));
  const sourceSet = new Set(sourceDeps.map(d => `${d.blockerId}->${d.blockedId}`));

  const missing = [...sourceSet].filter(s => !writtenSet.has(s));
  const extra = [...writtenSet].filter(s => !sourceSet.has(s));
  if (missing.length || extra.length) {
    throw new Error(`edge verification failed: missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`);
  }

  const skippedCategories: ImportReport['skippedCategories'] = [
    { category: 'documents', count: docCount, reason: 'documents are not imported by this ticket' },
  ];
  if (skipped.length) {
    skippedCategories.unshift({ category: 'dependencies', count: skipped.length, reason: 'endpoint ticket not imported' });
  }

  const report: ImportReport = {
    verdict: 'written',
    projectSlug: TARGET_SLUG,
    projectKey: key,
    projectName: TARGET_NAME,
    designSize: designMarkdown.length,
    designOpeningLine: firstLine(designMarkdown),
    sourceTicketCount: sourceTickets.length,
    importedTicketCount: orderedTickets.length,
    sourceDepCount: sourceDeps.length,
    importedDepCount: edges.length,
    skippedDepCount: skipped.length,
    skippedCategories,
    tickets: orderedTickets,
    edges,
    rewrittenRefs,
    readyTickets: readyRefs(orderedTickets, edges),
  };

  if (dryRun) {
    throw new DryRunAbort(report);
  }

  return report;
}

async function main() {
  const { dryRun, sourcePath } = parseArgs(process.argv.slice(2));

  let source: ReturnType<typeof openSource> | undefined;
  try {
    source = openSource(sourcePath);
  } catch (e) {
    console.error(`could not open ${sourcePath}: ${(e as Error).message}`);
    process.exit(1);
  }

  const sql = connect();
  let exit = 0;
  try {
    await migrate(sql);
    const report = await sql.begin(async tx => {
      return await buildReport(tx as unknown as Sql, dryRun, source!.db);
    });
    console.log(formatReport(report));
  } catch (e) {
    if (e instanceof DryRunAbort) {
      const report = { ...e.report, verdict: 'dry-run' as const };
      console.log(formatReport(report));
    } else {
      console.error((e as Error).message);
      exit = 1;
    }
  } finally {
    await sql.end();
    source.close();
  }
  process.exit(exit);
}

void main();
