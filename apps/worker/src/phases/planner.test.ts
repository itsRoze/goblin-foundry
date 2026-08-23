import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPrompt } from './planner.ts';
import type { Claim, PriorDesign } from '../db.ts';

const baseClaim: Claim = {
  runId: 'run_1', ticketId: 'tkt_1', projectId: 'prj_1', projectKey: 'TST', shortId: 1,
  title: 'A ticket', body: 'Do the thing.', repoPath: '/tmp/repo', defaultBranch: 'main',
  policy: { preset: 'standard' } as unknown as Claim['policy'],
  designId: null, designMarkdown: null, designNotes: [], projectDesignMarkdown: null, trigger: 'ready_for_design',
};

const schema = { type: 'object' };

test('firstPrompt includes the project design when one is present', () => {
  const design = '# Project design\n\nUse core/ for pure Kotlin.';
  const prompt = firstPrompt({ ...baseClaim, projectDesignMarkdown: design }, 'TEMPLATE', schema);
  assert.ok(prompt.includes('## Project context'));
  assert.ok(prompt.includes('Use core/ for pure Kotlin.'));
});

test('firstPrompt omits the project context when there is no project design', () => {
  const prompt = firstPrompt(baseClaim, 'TEMPLATE', schema);
  assert.ok(!prompt.includes('## Project context'));
});

test('firstPrompt still includes the ticket body and design template', () => {
  const prompt = firstPrompt(baseClaim, 'TEMPLATE', schema);
  assert.ok(prompt.includes('Do the thing.'));
  assert.ok(prompt.includes('TEMPLATE'));
  assert.ok(prompt.includes('End with ONLY this JSON object'));
});
