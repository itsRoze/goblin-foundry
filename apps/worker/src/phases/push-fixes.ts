import type { BuildOutput, EnvelopeBase, ReviewOutput } from '@goblin/schema';
import * as db from '../db.ts';
import { commitAll, hasCommitsSince, hasRemote, isClean, pushBranch } from '../git.ts';
import type { PhaseAttempt, PhaseContext, PhaseSpec } from '../pipeline.ts';

/**
 * Anything the fix loop changed belongs on the branch the pull request already
 * points at. A review that found nothing leaves the worktree untouched, and
 * this phase says so rather than inventing a commit.
 */
export const pushFixesPhase: PhaseSpec<EnvelopeBase> = {
  name: 'push_fixes',
  kind: 'code',
  agentName: null,
  envelope: 'GenericOutput',
  gates: [],
  run: runPushFixes,
};

async function runPushFixes(
  ctx: PhaseContext, handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<EnvelopeBase>> {
  const { claim, runId, phaseId, worktree } = ctx;
  if (!worktree) throw new Error('push_fixes phase requires a worktree');
  const review = handoff as ReviewOutput | null;

  const dirty = !(await isClean(worktree.path));
  if (!dirty && !(await hasCommitsSince(worktree.path, worktree.baseSha))) {
    return {
      status: 'success',
      envelope: {
        status: 'success', summary: 'review found nothing to change',
        artifacts: [worktree.branch], notes_for_next_agent: review?.summary ?? '',
      },
    };
  }

  if (dirty) {
    // Not folded back to the base commit: the branch's earlier commits are the
    // build under review, and a fix is a commit of its own on top of them.
    const commit = await commitAll(
      worktree.path,
      `FAC-${claim.shortId}: address review findings`,
      { ticket: `FAC-${claim.shortId}`, run: runId, phase: 'builder_fix', design: claim.designId },
    );
    await db.event({ runId, phaseId, type: 'log', name: 'fix commit',
                     payload: { code: commit.code, out: commit.stdout.slice(-500) } });
  }

  let summary = 'fixes committed to the branch';
  if (await hasRemote(claim.repoPath)) {
    const push = await pushBranch(worktree.path, worktree.branch);
    await db.event({ runId, phaseId, type: push.code === 0 ? 'log' : 'error',
                     name: push.code === 0 ? 'pushed' : 'push failed',
                     payload: { branch: worktree.branch, detail: (push.stderr || push.stdout).slice(-500) } });
    summary = push.code === 0
      ? `fixes pushed to ${worktree.branch}`
      : `fixes committed but push failed: ${push.stderr.slice(-200)}`;
  }

  return {
    status: 'success',
    envelope: {
      status: 'success', summary, artifacts: [worktree.branch],
      notes_for_next_agent: review?.summary ?? '',
    },
  };
}
