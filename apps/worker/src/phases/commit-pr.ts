import { formatRef, type BuildOutput, type EnvelopeBase } from '@goblin/schema';
import * as db from '../db.ts';
import {
  commitAll, hasCommitsSince, hasRemote, isClean, pushAndOpenPr, pushRejected,
} from '../git.ts';
import type { PhaseAttempt, PhaseContext, PhaseSpec } from '../pipeline.ts';

/**
 * Folds the attempt into one commit carrying the provenance trailers, pushes
 * where a remote exists, and opens the pull request. The harness owns this
 * commit, not the agent that produced the diff.
 */
export const commitAndPrPhase: PhaseSpec<EnvelopeBase> = {
  name: 'commit_and_pr',
  kind: 'code',
  agentName: null,
  envelope: 'GenericOutput',
  gates: [],
  run: runCommitAndPr,
};

async function runCommitAndPr(
  ctx: PhaseContext, handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<EnvelopeBase>> {
  const { claim, runId, phaseId, worktree } = ctx;
  if (!worktree) throw new Error('commit_and_pr phase requires a worktree');
  // Only the builder precedes this phase today; its envelope carries the
  // commit message and the narrative this phase folds into the PR body.
  const build = handoff as BuildOutput | null;

  const ref = formatRef(claim.projectKey, claim.shortId);
  if (!(await isClean(worktree.path)) || await hasCommitsSince(worktree.path, worktree.baseSha)) {
    const commit = await commitAll(
      worktree.path,
      build?.commit_message || `${ref}: ${claim.title}`,
      { ticket: ref, run: runId, phase: 'commit_and_pr/1', design: claim.designId },
      worktree.baseSha,
    );
    await db.event({ runId, phaseId, type: 'log', name: 'commit',
                     payload: { code: commit.code, out: commit.stdout.slice(-500) } });
  }

  const artifacts: string[] = [worktree.branch];
  const prBody = prBodyFor(claim, build);
  let summary: string;
  if (await hasRemote(claim.repoPath)) {
    const pr = await pushAndOpenPr(worktree.path, worktree.branch, claim.defaultBranch,
      `${ref}: ${claim.title}`, prBody);
    await db.event({ runId, phaseId, type: pr.ok ? 'log' : 'error',
                     name: pr.ok ? 'pull request' : 'pr failed', payload: { url: pr.url, detail: pr.detail } });
    if (pr.ok) { artifacts.push(pr.url); summary = `pull request opened: ${pr.url}`; }
    else summary = `pull request failed: ${pr.detail.slice(0, 200)}`;
  } else {
    await db.event({ runId, phaseId, type: 'log', name: 'no remote',
                     payload: { branch: worktree.branch, note: 'branch left local; add a git remote to open PRs',
                                pr_body: prBody } });
    summary = 'no remote configured — branch left local, no pull request opened';
  }

  const envelope: EnvelopeBase = { status: 'success', summary, artifacts, notes_for_next_agent: '' };
  return { status: 'success', envelope };
}

function prBodyFor(claim: db.Claim, build: BuildOutput | null): string {
  const ref = formatRef(claim.projectKey, claim.shortId);
  if (!build) return `## ${ref}: ${claim.title}\n`;
  return [
    `## ${ref}: ${claim.title}`,
    '', build.summary, '',
    '### Evidence',
    ...build.evidence.map(e => `- **${e.what}** — \`${e.command}\`\n  \n  \`\`\`\n  ${e.output.slice(0, 600)}\n  \`\`\``),
    '',
    build.deviations.length ? `### Deviations\n${build.deviations.map(d => `- ${d}`).join('\n')}` : '',
    '',
    '### Handoff', build.handoff, '',
    '### Provenance',
    `- Run \`${claim.runId}\``,
    claim.designId ? `- Design \`${claim.designId}\` (stored in the factory DB, not in this repo)` : '',
  ].filter(Boolean).join('\n');
}
