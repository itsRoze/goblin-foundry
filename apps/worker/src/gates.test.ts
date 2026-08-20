import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PlanOutput } from '@goblin/schema';
import { design_complete, earsCriteria, review_readable, section, verdict_consistent } from './gates.ts';

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
