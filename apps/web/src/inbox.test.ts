import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGER_STAGES } from '@goblin/schema';
import {
  approvalsFrom, groupByPhase, inboxCount, isStale, roundsFrom, sectionize, stuckFrom,
  type QuestionRow, type StuckTicketRow,
} from './inbox.ts';

const project = { key: 'FAC' };
const ticket = (title = 'One page for everything') => ({ shortId: 10, title, project });

function question(over: Partial<QuestionRow> & { phaseId: string; askedAt: number }): QuestionRow {
  return {
    id: over.id ?? `q_${over.phaseId}_${over.askedAt}`,
    header: over.header ?? 'Which one?',
    answeredAt: over.answeredAt ?? null,
    phase: over.phase ?? { agent: 'planner' },
    run: over.run ?? { id: 'run_1', status: 'awaiting_input', costUsd: 1.5, ticket: ticket() },
    ...over,
  };
}

// ── groupByPhase() ───────────────────────────────────────────────────────────

test('groupByPhase() is the one grouping rule — same phase together, different phases apart', () => {
  const groups = groupByPhase([
    { phaseId: 'ph_1', v: 'a' }, { phaseId: 'ph_2', v: 'b' }, { phaseId: 'ph_1', v: 'c' },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find(g => g[0]!.phaseId === 'ph_1')!.map(x => x.v), ['a', 'c']);
});

// ── Round grouping ─────────────────────────────────────────────────────────

test('roundsFrom() groups the open questions of one phase into one round', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_1', askedAt: 100 }),
    question({ phaseId: 'ph_1', askedAt: 200 }),
  ]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0]!.questions.length, 2);
});

test('roundsFrom() never merges two phases into one round', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_1', askedAt: 100 }),
    question({ phaseId: 'ph_2', askedAt: 100 }),
  ]);
  assert.equal(rounds.length, 2);
});

test('roundsFrom() drops answered questions entirely', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_1', askedAt: 100, answeredAt: 150 }),
    question({ phaseId: 'ph_1', askedAt: 200 }),
  ]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0]!.questions.length, 1);
  assert.equal(rounds[0]!.questions[0]!.askedAt, 200);
});

test('roundsFrom() produces no round once every question in a phase is answered', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_1', askedAt: 100, answeredAt: 150 }),
  ]);
  assert.equal(rounds.length, 0);
});

test('roundsFrom() treats a single question as a round of one', () => {
  const rounds = roundsFrom([question({ phaseId: 'ph_1', askedAt: 100 })]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0]!.questions.length, 1);
  assert.equal(rounds[0]!.firstUnanswered.id, rounds[0]!.questions[0]!.id);
});

test('roundsFrom() carries the ref, agent, parked time and spend a row needs', () => {
  const [round] = roundsFrom([
    question({
      phaseId: 'ph_1', askedAt: 500, header: 'Which store?',
      phase: { agent: 'planner' },
      run: { id: 'run_9', status: 'awaiting_input', costUsd: 3.2, ticket: { shortId: 10, title: 'Inbox', project: { key: 'FAC' } } },
    }),
  ]);
  assert.equal(round!.ticketRef, 'FAC-10');
  assert.equal(round!.agent, 'planner');
  assert.equal(round!.parkedAtMs, 500);
  assert.equal(round!.costUsd, 3.2);
});

// ── Stale predicate ─────────────────────────────────────────────────────────

test('isStale() is true for every terminal run status', () => {
  for (const status of ['success', 'fail', 'canceled'] as const) {
    const [round] = roundsFrom([question({ phaseId: 'ph_1', askedAt: 1, run: { id: 'r', status, costUsd: 0, ticket: ticket() } })]);
    assert.equal(isStale(round!), true, status);
  }
});

test('isStale() is false while the run is running or awaiting input', () => {
  for (const status of ['running', 'awaiting_input', 'queued'] as const) {
    const [round] = roundsFrom([question({ phaseId: 'ph_1', askedAt: 1, run: { id: 'r', status, costUsd: 0, ticket: ticket() } })]);
    assert.equal(isStale(round!), false, status);
  }
});

// ── Approvals ────────────────────────────────────────────────────────────

test('approvalsFrom() drops a design whose ticket or project has not synced yet', () => {
  const approvals = approvalsFrom([
    { id: 'd1', version: 1, status: 'in_review', markdown: 'x', createdAt: 1, ticket: null },
  ]);
  assert.equal(approvals.length, 0);
});

test('approvalsFrom() carries the notes array through, not just a count', () => {
  const [approval] = approvalsFrom([
    { id: 'd1', version: 2, status: 'in_review', markdown: 'x', createdAt: 1, notes: [{ note: 'a' }, { note: 'b' }], ticket: ticket() },
  ]);
  assert.equal(approval!.notes.length, 2);
});

// ── Stuck predicate ─────────────────────────────────────────────────────────

const proj = { id: 'proj_1', key: 'FAC' };
function stuckTicket(over: Partial<StuckTicketRow>): StuckTicketRow {
  return {
    id: 'tk_1', shortId: 10, title: 'Some ticket', project: proj,
    status: { kind: 'designing' },
    runs: [{ id: 'run_1', status: 'fail', trigger: 'ready_for_design', terminalReason: 'planner:worker_error', costUsd: 4, startedAt: 1, endedAt: 2 }],
    ...over,
  };
}

test('stuckFrom() flags a failed planner run leaving a ticket in Designing', () => {
  const stuck = stuckFrom([stuckTicket({})], TRIGGER_STAGES);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0]!.returnsToKind, 'ready_for_design');
});

test('stuckFrom() flags a failed build leaving a ticket in Building', () => {
  const stuck = stuckFrom([stuckTicket({
    status: { kind: 'building' },
    runs: [{ id: 'run_1', status: 'fail', trigger: 'ready_for_dev', costUsd: 2, startedAt: 1, endedAt: 2 }],
  })], TRIGGER_STAGES);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0]!.returnsToKind, 'ready_for_dev');
});

test('stuckFrom() flags a failed review leaving a ticket In Review, where working and trigger coincide', () => {
  const stuck = stuckFrom([stuckTicket({
    status: { kind: 'in_review' },
    runs: [{ id: 'run_1', status: 'fail', trigger: 'in_review', costUsd: 2, startedAt: 1, endedAt: 2 }],
  })], TRIGGER_STAGES);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0]!.returnsToKind, 'in_review');
});

test('stuckFrom() does not flag a ticket the reaper already requeued', () => {
  // Moved back to the trigger status, not sitting in the working status anymore.
  const stuck = stuckFrom([stuckTicket({ status: { kind: 'ready_for_design' } })], TRIGGER_STAGES);
  assert.equal(stuck.length, 0);
});

test('stuckFrom() judges a restarted ticket on its newest run only, never an older canceled one — even when both are present in .runs', () => {
  // .runs[0] is what the ticket-rooted, one-run-limit query hands back (newest
  // first); an older canceled run at .runs[1] proves stuckFrom looks only at
  // the head of the array and never falls through to an earlier entry.
  const stuck = stuckFrom([stuckTicket({
    status: { kind: 'designing' },
    runs: [
      { id: 'run_2', status: 'running', trigger: 'ready_for_design', costUsd: 1, startedAt: 5 },
      { id: 'run_1', status: 'canceled', trigger: 'ready_for_design', costUsd: 1, startedAt: 1, endedAt: 2 },
    ],
  })], TRIGGER_STAGES);
  assert.equal(stuck.length, 0);
});

test('stuckFrom() does not flag a successful run that moved its ticket', () => {
  const stuck = stuckFrom([stuckTicket({
    status: { kind: 'design_review' },
    runs: [{ id: 'run_1', status: 'success', trigger: 'ready_for_design', costUsd: 1, startedAt: 1, endedAt: 2 }],
  })], TRIGGER_STAGES);
  assert.equal(stuck.length, 0);
});

test('stuckFrom() does not flag a resting ticket with no runs at all', () => {
  const stuck = stuckFrom([stuckTicket({ status: { kind: 'backlog' }, runs: [] })], TRIGGER_STAGES);
  assert.equal(stuck.length, 0);
});

test('stuckFrom() names the status a ticket returns to as the project names it', () => {
  const stuck = stuckFrom(
    [stuckTicket({})],
    TRIGGER_STAGES,
    [{ projectId: 'proj_1', kind: 'ready_for_design', name: 'Ready for Design' }],
  );
  assert.equal(stuck[0]!.returnsToName, 'Ready for Design');
});

// ── sectionize(): the fixed order each section is shown in ─────────────────────

test('sectionize() orders Blocking a run longest-parked first — a parked run costs money every minute', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_new', askedAt: 500 }),
    question({ phaseId: 'ph_old', askedAt: 100 }),
    question({ phaseId: 'ph_mid', askedAt: 300 }),
  ]);
  const sections = sectionize(rounds, [], []);
  assert.deepEqual(sections.blocking.map(r => r.phaseId), ['ph_old', 'ph_mid', 'ph_new']);
});

test('sectionize() orders Waiting newest-submitted first', () => {
  const approvals = approvalsFrom([
    { id: 'd_old', version: 1, status: 'in_review', markdown: '', createdAt: 100, ticket: ticket() },
    { id: 'd_new', version: 1, status: 'in_review', markdown: '', createdAt: 300, ticket: ticket() },
    { id: 'd_mid', version: 1, status: 'in_review', markdown: '', createdAt: 200, ticket: ticket() },
  ]);
  const sections = sectionize([], approvals, []);
  assert.deepEqual(sections.waiting.map(a => a.designId), ['d_new', 'd_mid', 'd_old']);
});

test('sectionize() orders Stuck newest-failure first', () => {
  const stuck = stuckFrom([
    stuckTicket({ id: 'tk_old', runs: [{ id: 'r', status: 'fail', trigger: 'ready_for_design', costUsd: 1, startedAt: 1, endedAt: 100 }] }),
    stuckTicket({ id: 'tk_new', runs: [{ id: 'r', status: 'fail', trigger: 'ready_for_design', costUsd: 1, startedAt: 1, endedAt: 300 }] }),
    stuckTicket({ id: 'tk_mid', runs: [{ id: 'r', status: 'fail', trigger: 'ready_for_design', costUsd: 1, startedAt: 1, endedAt: 200 }] }),
  ], TRIGGER_STAGES);
  const sections = sectionize([], [], stuck);
  assert.deepEqual(sections.stuck.map(s => s.ticketId), ['tk_new', 'tk_mid', 'tk_old']);
});

// ── The shared count ─────────────────────────────────────────────────────────

test('inboxCount() counts rounds, approvals and stuck, and excludes stale', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_live', askedAt: 1, run: { id: 'r1', status: 'awaiting_input', costUsd: 0, ticket: ticket() } }),
    question({ phaseId: 'ph_dead', askedAt: 2, run: { id: 'r2', status: 'fail', costUsd: 0, ticket: ticket() } }),
  ]);
  const approvals = approvalsFrom([{ id: 'd1', version: 1, status: 'in_review', markdown: '', createdAt: 1, ticket: ticket() }]);
  const stuck = stuckFrom([stuckTicket({})], TRIGGER_STAGES);

  const sections = sectionize(rounds, approvals, stuck);
  assert.equal(sections.stale.length, 1);
  assert.equal(inboxCount(sections), 3);
});

test('sectionize() and inboxCount() are the one path the badge and the page both read', () => {
  const rounds = roundsFrom([question({ phaseId: 'ph_1', askedAt: 1 })]);
  const sections = sectionize(rounds, [], []);
  assert.equal(sections.blocking.length, inboxCount(sections));
});
