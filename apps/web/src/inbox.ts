import type { StatusKind, TriggerStage } from '@goblin/schema';
import { formatRef } from '@goblin/schema';

/**
 * Pure functions turning synced rows into inbox items: round grouping, the
 * stale predicate, the stuck predicate, and the count the topbar badge and
 * the page share. No React, no I/O — see inbox.test.ts.
 */

export type RunStatus = 'queued' | 'running' | 'awaiting_input' | 'success' | 'fail' | 'canceled';

const RUN_TERMINAL: ReadonlySet<RunStatus> = new Set(['success', 'fail', 'canceled']);

// ── Rounds ───────────────────────────────────────────────────────────────

export type QuestionRow = {
  id: string;
  phaseId: string;
  header: string;
  prompt?: string;
  options?: readonly { label: string; description: string }[];
  multiSelect?: boolean;
  askedAt: number;
  answeredAt?: number | null;
  phase?: { agent?: string | null } | null;
  run?: {
    id: string;
    status: RunStatus;
    costUsd: number;
    ticket?: {
      shortId: number;
      title: string;
      project?: { key: string } | null;
    } | null;
  } | null;
};

/**
 * A round is the set of open questions sharing a phase — a phase writes its
 * questions and then blocks until all of them are answered, so at most one
 * round can be open per phase at a time. This is the one place that grouping
 * happens; apps/web/src/components/Questions.tsx reuses it rather than
 * bucketing by asked-at, which can split one round or merge two.
 */
export function groupByPhase<T extends { phaseId: string }>(items: readonly T[]): T[][] {
  const byPhase = new Map<string, T[]>();
  for (const item of items) byPhase.set(item.phaseId, [...(byPhase.get(item.phaseId) ?? []), item]);
  return [...byPhase.values()];
}

export type Round = {
  kind: 'round';
  id: string;
  phaseId: string;
  runId: string;
  runStatus: RunStatus;
  ticketRef: string;
  ticketTitle: string;
  projectKey: string;
  agent: string;
  questions: QuestionRow[];
  firstUnanswered: QuestionRow;
  parkedAtMs: number;
  costUsd: number;
};

/** Every unanswered question, grouped into rounds by groupByPhase(). */
export function roundsFrom(questions: readonly QuestionRow[]): Round[] {
  const open = questions.filter(q => !q.answeredAt && q.run?.ticket?.project);
  return groupByPhase(open).map(qs => {
    const sorted = [...qs].sort((a, b) => a.askedAt - b.askedAt || a.id.localeCompare(b.id));
    const first = sorted[0]!;
    const run = first.run!;
    const ticket = run.ticket!;
    const project = ticket.project!;
    return {
      kind: 'round' as const,
      id: `round:${first.phaseId}`,
      phaseId: first.phaseId,
      runId: run.id,
      runStatus: run.status,
      ticketRef: formatRef(project.key, ticket.shortId),
      ticketTitle: ticket.title,
      projectKey: project.key,
      agent: first.phase?.agent ?? '',
      questions: sorted,
      firstUnanswered: sorted[0]!,
      parkedAtMs: Math.min(...sorted.map(q => q.askedAt)),
      costUsd: run.costUsd,
    };
  });
}

/** A stale round's run has already ended — answering it would reach nobody. */
export function isStale(round: Round): boolean {
  return RUN_TERMINAL.has(round.runStatus);
}

// ── Approvals ────────────────────────────────────────────────────────────

export type ApprovalDesignRow = {
  id: string;
  version: number;
  status: string;
  reviewHtml?: string | null;
  markdown: string;
  notes?: readonly unknown[] | null;
  createdAt: number;
  ticket?: {
    shortId: number;
    title: string;
    project?: { key: string } | null;
  } | null;
};

export type Approval = {
  kind: 'approval';
  id: string;
  designId: string;
  version: number;
  status: string;
  ticketRef: string;
  ticketTitle: string;
  projectKey: string;
  submittedAtMs: number;
  reviewHtml: string;
  markdown: string;
  notes: readonly unknown[];
};

/** Every design still awaiting a decision — the query already scopes to `in_review`. */
export function approvalsFrom(designs: readonly ApprovalDesignRow[]): Approval[] {
  const out: Approval[] = [];
  for (const d of designs) {
    if (!d.ticket?.project) continue;
    out.push({
      kind: 'approval',
      id: `approval:${d.id}`,
      designId: d.id,
      version: d.version,
      status: d.status,
      ticketRef: formatRef(d.ticket.project.key, d.ticket.shortId),
      ticketTitle: d.ticket.title,
      projectKey: d.ticket.project.key,
      submittedAtMs: d.createdAt,
      reviewHtml: d.reviewHtml ?? '',
      markdown: d.markdown,
      notes: d.notes ?? [],
    });
  }
  return out;
}

// ── Stuck ────────────────────────────────────────────────────────────────

export type StuckStatusRow = { projectId: string; kind: StatusKind; name: string };

export type StuckTicketRow = {
  id: string;
  shortId: number;
  title: string;
  project?: { id: string; key: string } | null;
  status?: { kind: StatusKind } | null;
  runs: readonly {
    id: string;
    status: RunStatus;
    trigger: string;
    terminalReason?: string | null;
    costUsd: number;
    startedAt: number;
    endedAt?: number | null;
  }[];
};

export type Stuck = {
  kind: 'stuck';
  id: string;
  ticketId: string;
  ticketRef: string;
  ticketTitle: string;
  projectKey: string;
  runId: string;
  terminalReason: string;
  costUsd: number;
  /** The status kind (and, when known, its name in this project) retry sends the ticket back to. */
  returnsToKind: StatusKind;
  returnsToName: string;
  endedAt: number;
};

/**
 * The whole predicate: the ticket's most recent run has ended (fail or
 * canceled) and the ticket is still sitting in that run's working status.
 * `statuses` resolves the trigger status's project-local name for the row;
 * falling back to the kind itself when no matching row is loaded yet.
 */
export function stuckFrom(
  tickets: readonly StuckTicketRow[],
  triggerStages: Partial<Record<StatusKind, TriggerStage>>,
  statuses: readonly StuckStatusRow[] = [],
): Stuck[] {
  const out: Stuck[] = [];
  for (const t of tickets) {
    const run = t.runs[0];
    if (!run || !t.status || !t.project) continue;
    if (run.status !== 'fail' && run.status !== 'canceled') continue;
    const stage = triggerStages[run.trigger as StatusKind];
    if (!stage) continue;
    if (t.status.kind !== stage.working) continue;
    const returnsToKind = run.trigger as StatusKind;
    const returnsToName =
      statuses.find(s => s.projectId === t.project!.id && s.kind === returnsToKind)?.name ?? returnsToKind;
    out.push({
      kind: 'stuck',
      id: `stuck:${t.id}`,
      ticketId: t.id,
      ticketRef: formatRef(t.project.key, t.shortId),
      ticketTitle: t.title,
      projectKey: t.project.key,
      runId: run.id,
      terminalReason: run.terminalReason ?? run.status,
      costUsd: run.costUsd,
      returnsToKind,
      returnsToName,
      endedAt: run.endedAt ?? run.startedAt,
    });
  }
  return out;
}

// ── Sections and the shared count ───────────────────────────────────────

export type InboxSections = {
  blocking: Round[];
  waiting: Approval[];
  stuck: Stuck[];
  stale: Round[];
};

/**
 * Buckets rounds, approvals and stuck tickets into the inbox's fixed
 * sections and orders each: blocking rounds oldest-parked first (waiting
 * costs money there), approvals and stuck newest first, stale rounds
 * grouped on their own.
 */
export function sectionize(rounds: readonly Round[], approvals: readonly Approval[], stuck: readonly Stuck[]): InboxSections {
  const blocking = rounds.filter(r => !isStale(r)).sort((a, b) => a.parkedAtMs - b.parkedAtMs);
  const stale = rounds.filter(isStale).sort((a, b) => b.parkedAtMs - a.parkedAtMs);
  const waiting = [...approvals].sort((a, b) => b.submittedAtMs - a.submittedAtMs);
  const stuckSorted = [...stuck].sort((a, b) => b.endedAt - a.endedAt);
  return { blocking, waiting, stuck: stuckSorted, stale };
}

/** Rounds + approvals + stuck, excluding stale — the one function the badge and the page share. */
export function inboxCount(sections: Pick<InboxSections, 'blocking' | 'waiting' | 'stuck'>): number {
  return sections.blocking.length + sections.waiting.length + sections.stuck.length;
}
