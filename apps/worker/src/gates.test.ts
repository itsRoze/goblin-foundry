import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Finding, PlanOutput, ReviewOutput } from '@goblin/schema';
import {
  design_complete, earsCriteria, lens_coverage, refutation_attempted, review_readable,
  review_verdict_consistent, section, verdict_consistent,
} from './gates.ts';

const CTX = { worktree: '/tmp', base: '', testCommand: '' };

function plan(markdown: string, open: string[] = [], reviewHtml = REVIEW): PlanOutput {
  return {
    status: 'success', summary: '', artifacts: [], notes_for_next_agent: '',
    design_markdown: markdown, review_html: reviewHtml, open_questions: open,
  };
}

const REVIEW = `<style>body{font:14px system-ui}</style>
<h1>Questions reach the board</h1>
<p>Today a run cannot ask you anything, so the planner cannot grill you at all.
This change gives a parked run somewhere to put its question and gives you a
form to answer it without leaving the ticket you are already looking at.</p>
<h2>What changes for you</h2>
<p>A card that is waiting says so, and the ticket page grows an answer form.</p>
<h2>Mockup</h2>
<div style="border:1px solid #ccc;padding:8px">Which store? [Postgres] [SQLite]</div>
<h2>Decision log</h2>
<ul><li>Poll for the answer rather than adding a second NOTIFY channel.</li></ul>`;

const GOOD = `# Design: questions reach the board

## Problem Statement

A run cannot ask the human anything, so the planner cannot grill anyone. The
question table exists and nothing writes it.

## Acceptance Criteria

- WHEN an agent asks a question, THE factory SHALL store it and park the phase.
- WHEN the human answers on the board, THE factory SHALL resume the parked phase.
- IF the worker driving a parked run dies, THEN THE factory SHALL sweep the run.

## Out of Scope

The planner phase itself, which is its own ticket.
`;

test('section() returns a section body and null for a heading that is absent', () => {
  assert.match(section(GOOD, 'Problem Statement')!, /^A run cannot ask/);
  assert.equal(section(GOOD, 'Test Plan'), null);
});

test('section() stops at the next heading', () => {
  assert.ok(!section(GOOD, 'Problem Statement')!.includes('Acceptance Criteria'));
});

test('earsCriteria() finds WHEN/IF criteria and ignores prose elsewhere', () => {
  const found = earsCriteria(GOOD);
  assert.equal(found.length, 3);
  assert.match(found[0]!, /^- WHEN an agent asks/);
  assert.deepEqual(earsCriteria('## Acceptance Criteria\n\nIt works correctly.'), []);
});

test('design_complete passes a design that carries its sections and criteria', async () => {
  const r = await design_complete(plan(GOOD), CTX);
  assert.equal(r.passed, true, JSON.stringify(r.checks));
});

test('design_complete fails a design with a clarification marker left in it', async () => {
  const r = await design_complete(plan(`${GOOD}\n[NEEDS CLARIFICATION: which store?]`), CTX);
  assert.equal(r.passed, false);
  assert.equal(r.checks.find(c => c.item === 'no [NEEDS CLARIFICATION]')?.ok, false);
});

test('design_complete names the missing section rather than just failing', async () => {
  const without = GOOD.replace('## Out of Scope', '## Something Else');
  const r = await design_complete(plan(without), CTX);
  assert.equal(r.passed, false);
  const check = r.checks.find(c => c.item === 'section: Out of Scope');
  assert.equal(check?.ok, false);
  assert.equal(check?.note, 'heading missing');
});

test('design_complete rejects criteria that are not verifiable', async () => {
  const vague = GOOD.replace(/- (WHEN|IF)[^\n]*\n/g, '- It works correctly.\n');
  const r = await design_complete(plan(vague), CTX);
  assert.equal(r.checks.find(c => c.item === 'EARS acceptance criteria')?.ok, false);
});

test('verdict_consistent refuses a successful design that still has open questions', async () => {
  assert.equal((await verdict_consistent(plan(GOOD), CTX)).passed, true);
  const r = await verdict_consistent(plan(GOOD, ['Which store?']), CTX);
  assert.equal(r.passed, false);
  assert.match(r.checks[0]!.note, /Which store\?/);
});

test('review_readable accepts a self-contained document', async () => {
  const r = await review_readable(plan(GOOD), CTX);
  assert.equal(r.passed, true, JSON.stringify(r.checks));
});

test('review_readable rejects scripts and remote resources', async () => {
  const scripted = await review_readable(plan(GOOD, [], `${REVIEW}<script>alert(1)</script>`), CTX);
  assert.equal(scripted.checks.find(c => c.item === 'no scripts')?.ok, false);
  const remote = await review_readable(plan(GOOD, [], `${REVIEW}<img src="https://example.com/a.png">`), CTX);
  assert.equal(remote.checks.find(c => c.item === 'no external resources')?.ok, false);
});

test('review_readable rejects a review document that was never written', async () => {
  const r = await review_readable(plan(GOOD, [], ''), CTX);
  assert.equal(r.passed, false);
  assert.equal(r.checks[0]!.note, '0 characters');
});

// ── Review gates ────────────────────────────────────────────────────────────

function finding(over: Partial<Finding> = {}): Finding {
  return {
    lens: 'correctness', requirement: 'WHEN input is unicode, THE slug SHALL keep letters',
    met: false, evidence: 'the regex strips every non-ascii character',
    severity: 'important', refuted: false, refutation: '', ...over,
  };
}

function review(over: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    status: 'success', summary: '', artifacts: [], notes_for_next_agent: '',
    lenses_run: ['correctness', 'tests'], findings: [], verdict: 'approve', ...over,
  };
}

const REVIEW_CTX = { worktree: '/tmp', base: '', testCommand: '', lenses: ['correctness', 'tests'], blockOn: 'important' as const };

test('review_verdict_consistent passes an approve with nothing blocking', async () => {
  const r = await review_verdict_consistent(review({ findings: [finding({ met: true })] }), REVIEW_CTX);
  assert.equal(r.passed, true, JSON.stringify(r.checks));
});

test('review_verdict_consistent catches an approve that ignores its own finding', async () => {
  const r = await review_verdict_consistent(review({ findings: [finding()] }), REVIEW_CTX);
  assert.equal(r.passed, false);
  assert.match(r.checks[0]!.note, /approve with 1 blocking/);
});

test('review_verdict_consistent lets a refuted finding through', async () => {
  const refuted = finding({ refuted: true, refutation: 'the branch normalizes first' });
  assert.equal((await review_verdict_consistent(review({ findings: [refuted] }), REVIEW_CTX)).passed, true);
});

test('review_verdict_consistent demands evidence for an unmet finding', async () => {
  const r = await review_verdict_consistent(
    review({ verdict: 'changes_requested', findings: [finding({ evidence: '  ' })] }), REVIEW_CTX);
  assert.equal(r.passed, false);
  assert.equal(r.checks.at(-1)!.note, 'unmet with no evidence');
});

test('lens_coverage names the lens that never ran', async () => {
  const r = await lens_coverage(review({ lenses_run: ['correctness'] }), REVIEW_CTX);
  assert.equal(r.passed, false);
  assert.equal(r.checks.find(c => c.item === 'lens: tests')?.note, 'never ran');
});

test('lens_coverage passes when every policy lens reported', async () => {
  assert.equal((await lens_coverage(review(), REVIEW_CTX)).passed, true);
});

test('refutation_attempted passes when every unmet finding was challenged', async () => {
  const r = await refutation_attempted(review({
    findings: [finding({ refuted: true, refutation: 'covered by existing test' })],
  }), REVIEW_CTX);
  assert.equal(r.passed, true, JSON.stringify(r.checks));
});

test('refutation_attempted fails when an unmet finding was never challenged', async () => {
  const r = await refutation_attempted(review({ findings: [finding()] }), REVIEW_CTX);
  assert.equal(r.passed, false);
  assert.match(r.checks[0]!.note, /never challenged/);
});

test('refutation_attempted passes when no findings are unmet', async () => {
  const r = await refutation_attempted(review({ findings: [finding({ met: true })] }), REVIEW_CTX);
  assert.equal(r.passed, true, JSON.stringify(r.checks));
});

// ── A push that was refused is not a push ───────────────────────────────────

test('pushRejected recognises the refusals that mean the branch moved', async () => {
  const { pushRejected } = await import('./git.ts');
  assert.equal(pushRejected(' ! [rejected]        goblin/fac-10 -> goblin/fac-10 (non-fast-forward)'), true);
  assert.equal(pushRejected('Updates were rejected because the remote contains work; fetch first'), true);
  assert.equal(pushRejected('fatal: could not read Username for https://github.com'), false);
});
