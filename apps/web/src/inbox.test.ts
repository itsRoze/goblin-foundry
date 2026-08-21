import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGER_STAGES } from '@goblin/schema';
import {
  approvalsFrom, inboxCount, isStale, roundsFrom, sectionize, stuckFrom,
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

test('stuckFrom() judges a restarted ticket on its newest run only, not an older canceled one', () => {
  const stuck = stuckFrom([stuckTicket({
    status: { kind: 'designing' },
    runs: [{ id: 'run_2', status: 'running', trigger: 'ready_for_design', costUsd: 1, startedAt: 5 }],
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

// ── The shared count ─────────────────────────────────────────────────────────

test('inboxCount() counts rounds, approvals and stuck, and excludes stale', () => {
  const rounds = roundsFrom([
    question({ phaseId: 'ph_live', askedAt: 1, run: { id: 'r1', status: 'awaiting_input', costUsd: 0, ticket: ticket() } }),
    question({ phaseId: 'ph_dead', askedAt: 2, run: { id: 'r2', status: 'fail', costUsd: 0, ticket: ticket() } }),
  ]);
  const approvals = approvalsFrom([{ id: 'd1', version: 1, markdown: '', createdAt: 1, ticket: ticket() }]);
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
