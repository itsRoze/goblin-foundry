import { formatRef } from './ref.ts';

export type SourceTicket = {
  id: number;
  position: number;
  title: string;
  body: string;
};

export type SourceDep = {
  blockerId: number;
  blockedId: number;
};

export type IdMapEntry = {
  sourceId: number;
  shortId: number;
  ref: string;
  title: string;
};

/**
 * Order source tickets by position, then by source id, and assign consecutive
 * short ids starting at 1.
 */
export function mapSourceTickets(
  tickets: readonly SourceTicket[],
  projectKey: string,
): Map<number, IdMapEntry> {
  const ordered = [...tickets].sort((a, b) => a.position - b.position || a.id - b.id);
  const map = new Map<number, IdMapEntry>();
  for (const [i, t] of ordered.entries()) {
    const shortId = i + 1;
    map.set(t.id, {
      sourceId: t.id,
      shortId,
      ref: formatRef(projectKey, shortId),
      title: t.title,
    });
  }
  return map;
}

export type TranslatedEdge = {
  blocker: IdMapEntry;
  blocked: IdMapEntry;
};

export type EdgeResult = {
  edges: TranslatedEdge[];
  skipped: { sourceBlocker: number; sourceBlocked: number; reason: string }[];
};

/**
 * Translate source dependency edges through the identifier map. An edge whose
 * blocker or blocked source id was not imported is reported as skipped rather
 * than dropped silently.
 */
export function translateEdges(deps: readonly SourceDep[], idMap: Map<number, IdMapEntry>): EdgeResult {
  const edges: TranslatedEdge[] = [];
  const skipped: EdgeResult['skipped'] = [];
  for (const d of deps) {
    const blocker = idMap.get(d.blockerId);
    const blocked = idMap.get(d.blockedId);
    if (!blocker) {
      skipped.push({ sourceBlocker: d.blockerId, sourceBlocked: d.blockedId, reason: `blocker ${d.blockerId} not imported` });
      continue;
    }
    if (!blocked) {
      skipped.push({ sourceBlocker: d.blockerId, sourceBlocked: d.blockedId, reason: `blocked ${d.blockedId} not imported` });
      continue;
    }
    edges.push({ blocker, blocked });
  }
  return { edges, skipped };
}

/**
 * Rewrite `#<sourceId>` references in ticket bodies to canonical refs when the
 * source id was imported, leaving every other number untouched. Returns the
 * rewritten body and the number of replacements made.
 */
export function rewriteBodyReferences(
  body: string,
  idMap: Map<number, IdMapEntry>,
): { body: string; rewritten: number } {
  const pattern = /#(\d+)/g;
  let rewritten = 0;
  const out = body.replace(pattern, (_m, num) => {
    const sourceId = Number(num);
    const entry = idMap.get(sourceId);
    if (!entry) return _m;
    rewritten++;
    return entry.ref;
  });
  return { body: out, rewritten };
}

export type ImportReport = {
  verdict: 'written' | 'dry-run' | 'no-op';
  projectSlug: string;
  projectKey: string;
  projectName: string;
  designSize: number;
  designOpeningLine: string;
  sourceTicketCount: number;
  importedTicketCount: number;
  sourceDepCount: number;
  importedDepCount: number;
  skippedDepCount: number;
  skippedCategories: { category: string; count: number; reason: string }[];
  tickets: IdMapEntry[];
  edges: TranslatedEdge[];
  rewrittenRefs: number;
  readyTickets: string[];
  deleteStatement?: string;
};

export function formatReport(r: ImportReport): string {
  const lines: string[] = [];
  const verdictWord = r.verdict === 'written' ? 'imported' : r.verdict === 'dry-run' ? 'dry run' : r.verdict;
  lines.push(`VERDICT: ${verdictWord}`);
  lines.push('');
  lines.push(`${r.projectName} (${r.projectSlug}) → ${r.projectKey}`);
  lines.push(`  project design: ${r.designSize} chars, opening line: ${r.designOpeningLine || '(empty)'}`);
  lines.push(`  tickets: ${r.importedTicketCount}/${r.sourceTicketCount}`);
  lines.push(`  dependencies: ${r.importedDepCount}/${r.sourceDepCount} (skipped ${r.skippedDepCount})`);
  lines.push(`  references rewritten: ${r.rewrittenRefs}`);
  lines.push('');
  lines.push('Identifier map:');
  for (const t of r.tickets) {
    lines.push(`  ${t.ref}  ←  smriti #${t.sourceId}  ${t.title}`);
  }
  lines.push('');
  lines.push('Dependency edges:');
  if (r.edges.length) {
    for (const e of r.edges) {
      lines.push(`  ${e.blocker.ref} → ${e.blocked.ref}`);
    }
  } else {
    lines.push('  (none)');
  }
  lines.push('');
  if (r.skippedCategories.length) {
    lines.push('Skipped:');
    for (const s of r.skippedCategories) {
      lines.push(`  ${s.category}: ${s.count} — ${s.reason}`);
    }
    lines.push('');
  }
  if (r.verdict === 'no-op') {
    lines.push('To re-run after removing the existing project:');
    lines.push(`  ${r.deleteStatement ?? `delete from project where slug = '${r.projectSlug}';`}`);
    lines.push('');
  }
  lines.push(`Ready to start (no unfinished blocker): ${r.readyTickets.join(', ') || '(none)'}`);
  return lines.join('\n');
}

