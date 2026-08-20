import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keepsWorktree, numberedPhases, phaseTerminalReason, pipelineFor,
  type Pipeline, type PhaseSpec,
} from './pipeline.ts';

function fakeSpec(name: string): PhaseSpec {
  return {
    name, kind: 'code', agentName: null, envelope: 'GenericOutput', gates: [],
    run: async () => ({
      status: 'success',
      envelope: { status: 'success', summary: '', artifacts: [], notes_for_next_agent: '' },
    }),
  };
}

function fakePipeline(...names: string[]): Pipeline {
  return {
    phases: names.map(fakeSpec), working: 'building', delegate: 'builder',
    success: 'in_review', worktree: 'fresh',
  };
}

test('pipelineFor() finds the pipeline registered for a trigger status kind', () => {
  const pipelines = { ready_for_dev: fakePipeline('builder', 'commit_and_pr') };
  assert.equal(pipelineFor(pipelines, 'ready_for_dev'), pipelines.ready_for_dev);
});

test('pipelineFor() returns undefined for a status kind with no pipeline registered', () => {
  const pipelines = { ready_for_dev: fakePipeline('builder') };
  assert.equal(pipelineFor(pipelines, 'backlog'), undefined);
  assert.equal(pipelineFor(pipelines, 'not-a-real-kind'), undefined);
});

test('a pipeline records the status kind a completed run moves the ticket to', () => {
  const pipeline = fakePipeline('builder');
  assert.equal(pipeline.success, 'in_review');
});

test('numberedPhases() numbers phases by position, starting at 1', () => {
  const pipeline = fakePipeline('builder', 'commit_and_pr', 'deploy');
  const numbered = numberedPhases(pipeline);
  assert.deepEqual(numbered.map(p => p.seq), [1, 2, 3]);
  assert.deepEqual(numbered.map(p => p.spec.name), ['builder', 'commit_and_pr', 'deploy']);
});

test('numberedPhases() numbers a single-phase pipeline as seq 1', () => {
  const numbered = numberedPhases(fakePipeline('builder'));
  assert.equal(numbered.length, 1);
  assert.equal(numbered[0]!.seq, 1);
});

test('phaseTerminalReason() names the phase that produced the reason', () => {
  assert.equal(phaseTerminalReason('builder', 'gates_failed'), 'builder:gates_failed');
  assert.equal(phaseTerminalReason('commit_and_pr', 'worker_error'), 'commit_and_pr:worker_error');
});

test('keepsWorktree() removes a fresh worktree on success, keeps it on failure', () => {
  assert.equal(keepsWorktree('fresh', 'success'), false);
  assert.equal(keepsWorktree('fresh', 'fail'), true);
});

test('keepsWorktree() never has anything to keep or remove for "none"', () => {
  assert.equal(keepsWorktree('none', 'success'), false);
  assert.equal(keepsWorktree('none', 'fail'), false);
});

test('keepsWorktree() leaves an attached worktree alone regardless of outcome', () => {
  assert.equal(keepsWorktree('attached', 'success'), true);
  assert.equal(keepsWorktree('attached', 'fail'), true);
});
