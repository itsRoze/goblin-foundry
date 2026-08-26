import { formatRef, type EnvelopeBase } from '@goblin/schema';
import * as db from './db.ts';
import {
  addWorktree, attachWorktree, commitAll, hasBranchWork, isClean, mergeBaseInto,
  removeWorktree, syncBase, type Worktree,
} from './git.ts';
import { asHalt, overBudget } from './halt.ts';
import {
  keepsWorktree, numberedPhases, phaseTerminalReason, pipelineFor,
  type PhaseAttempt, type PhaseContext, type PhaseSpec, type Pipeline,
} from './pipeline.ts';
import { TRIGGER_PIPELINES } from './pipelines.ts';

/** The base moved under a branch and the two disagree: a human's call. */
class BaseConflict extends Error {
  constructor(readonly conflicts: string[], detail = '') {
    super(conflicts.length
      ? `branch conflicts with its base in: ${conflicts.join(', ')}`
      : `branch could not merge its base: ${detail || 'unknown reason'}`);
  }
}

async function acquireWorktree(pipeline: Pipeline, claim: db.Claim, branch: string): Promise<Worktree | null> {
  if (pipeline.worktree === 'none') return null;
  const synced = await syncBase(claim.repoPath, claim.defaultBranch);
  await db.event({ runId: claim.runId, type: 'log', name: 'base branch',
                   payload: { base: claim.defaultBranch, result: synced } });
  // A branch that already carries commits is an earlier attempt that ran out of
  // turns or budget with real work on it. Cutting it fresh would throw that away
  // and pay to rebuild it; the retry continues from where the last one stopped.
  const resuming = pipeline.worktree === 'attached'
    || (pipeline.worktree === 'fresh' && await hasBranchWork(claim.repoPath, branch, claim.defaultBranch));
  let worktree = resuming
    ? await attachWorktree(claim.repoPath, branch, claim.defaultBranch)
    : await addWorktree(claim.repoPath, branch, claim.defaultBranch);
  if (resuming && pipeline.worktree === 'fresh') {
    await db.event({ runId: claim.runId, type: 'log', name: 'resuming branch',
                     payload: { branch, note: 'an earlier attempt left commits here' } });
  }
  // A branch that has been away while the base moved is reviewed and merged
  // against a repository that no longer exists. Catch it up here, where a
  // conflict is a run that stops with a reason, rather than on the pull
  // request, where it is a human resolving by hand.
  if (resuming) {
    // An earlier run may have died with work still uncommitted. It is real work
    // and it blocks the catch-up merge, so it lands as a commit of its own
    // rather than being stashed, abandoned, or merged over.
    if (!(await isClean(worktree.path))) {
      const wip = await commitAll(
        worktree.path,
        `${formatRef(claim.projectKey, claim.shortId)}: work left uncommitted by an earlier run`,
        { ticket: formatRef(claim.projectKey, claim.shortId), run: claim.runId,
          phase: 'resume', design: claim.designId },
      );
      await db.event({ runId: claim.runId, type: 'log', name: 'committed leftover work',
                       payload: { code: wip.code, out: wip.stdout.slice(-300) } });
    }
    const caught = await mergeBaseInto(worktree.path, claim.defaultBranch);
    await db.event({
      runId: claim.runId, type: caught.ok ? 'log' : 'error', name: 'catch up with base',
      payload: { base: claim.defaultBranch, merged: caught.merged, conflicts: caught.conflicts,
                 detail: caught.detail ?? '', base_sha: caught.baseSha ?? worktree.baseSha },
    });
    if (!caught.ok) throw new BaseConflict(caught.conflicts, caught.detail);
    // The diff gates measure against this commit. Catching up moves it: without
    // this, everything the base added since reads as an undeclared change by
    // the agent, and a correct fix is failed for work it never did.
    if (caught.baseSha) worktree = { ...worktree, baseSha: caught.baseSha };
  }
  await db.setRunBranch(claim.runId, worktree.path, branch);
  await db.event({ runId: claim.runId, type: 'log', name: 'worktree',
                   payload: { path: worktree.path, branch, base: claim.defaultBranch, base_sha: worktree.baseSha } });
  return worktree;
}

async function runOnePhase(
  spec: PhaseSpec<any>, ctx: PhaseContext, handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<any>> {
  try {
    return await spec.run(ctx, handoff);
  } catch (e) {
    const halt = asHalt(e);
    if (halt) return { status: 'fail', envelope: null, reason: halt.reason };
    await db.event({ runId: ctx.runId, phaseId: ctx.phaseId, type: 'error', name: 'worker error',
                     payload: { error: (e as Error).message, stack: (e as Error).stack?.slice(0, 2000) } });
    return { status: 'fail', envelope: null, reason: 'worker_error' };
  }
}

/**
 * Runs a claimed ticket's pipeline end to end: obtains the worktree, walks the
 * phases in order handing each the last one's envelope, moves the ticket and
 * cleans up on success, or stops and leaves everything in place on failure.
 */
export async function runPipeline(claim: db.Claim): Promise<'success' | 'fail'> {
  const pipeline = pipelineFor(TRIGGER_PIPELINES, claim.trigger);
  if (!pipeline) throw new Error(`no pipeline for trigger '${claim.trigger}'`);

  const branch = `goblin/${formatRef(claim.projectKey, claim.shortId).toLowerCase()}`;
  let worktree: Worktree | null;
  try {
    worktree = await acquireWorktree(pipeline, claim, branch);
  } catch (e) {
    const conflict = e instanceof BaseConflict;
    if (!conflict) {
      await db.event({ runId: claim.runId, type: 'error', name: 'worker error',
                       payload: { error: (e as Error).message, stack: (e as Error).stack?.slice(0, 2000) } });
    }
    await db.finishRun(claim.runId, 'fail', conflict ? 'base_conflict' : 'worktree_failed');
    await db.clearDelegate(claim.ticketId);
    return 'fail';
  }

  let handoff: EnvelopeBase | null = null;
  let outcome: 'success' | 'fail' = 'success';
  let terminalReason = 'completed';

  for (const { spec, seq } of numberedPhases(pipeline)) {
    // The per-ticket cap is the one budget that spans phases; a run that has
    // spent real money stops here rather than opening another agent. On
    // today's two subscription lanes this stays inert, which is honest — it
    // binds the day an api-key lane exists.
    const spent = await db.runBillableSpend(claim.runId);
    if (overBudget(spent, claim.policy.budgets.perTicketUsd ?? 0)) {
      await db.event({ runId: claim.runId, type: 'error', name: 'budget_exhausted',
                       payload: { billable_usd: spent, cap_usd: claim.policy.budgets.perTicketUsd,
                                  next_phase: spec.name } });
      outcome = 'fail';
      terminalReason = 'budget_exhausted';
      await db.clearDelegate(claim.ticketId);
      break;
    }
    const model = spec.modelFor?.(claim.policy);
    const phaseId = await db.startPhase(claim.runId, seq, spec.kind, spec.name, spec.agentName,
                                        model?.model ?? null, model?.effort ?? null,
                                        model?.harness ?? 'claude-code', model?.provider ?? null,
                                        model?.paidBy ?? 'unknown');
    await db.event({ runId: claim.runId, phaseId, type: 'phase_start', name: spec.name,
                     payload: { kind: spec.kind, ticket: formatRef(claim.projectKey, claim.shortId) } });

    const ctx: PhaseContext = { claim, runId: claim.runId, phaseId, worktree };
    const attempt = await runOnePhase(spec, ctx, handoff);

    await db.updatePhase(phaseId, { status: attempt.status, error: attempt.status === 'fail' ? attempt.reason : null });
    await db.event({ runId: claim.runId, phaseId, type: 'phase_end', name: spec.name,
                     payload: { status: attempt.status, reason: attempt.status === 'fail' ? attempt.reason : undefined } });

    if (attempt.status === 'fail') {
      outcome = 'fail';
      terminalReason = phaseTerminalReason(spec.name, attempt.reason);
      await db.clearDelegate(claim.ticketId);
      break;
    }
    handoff = attempt.envelope;
  }

  await db.finishRun(claim.runId, outcome, terminalReason);
  // A failed run leaves the ticket in `building` with the failure attached: it
  // needs you, and moving it back to the queue would just re-claim it forever.
  if (outcome === 'success') await db.moveTicket(claim.ticketId, claim.projectId, pipeline.success, null);
  if (worktree && !keepsWorktree(pipeline.worktree, outcome)) await removeWorktree(claim.repoPath, worktree.path);
  return outcome;
}
