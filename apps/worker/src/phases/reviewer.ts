import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blockingFindings, buildOutput, envelopeJsonSchema, formatRef, reviewOutput, violations,
  type BuildOutput, type EnvelopeBase, type Finding, type ReviewOutput,
} from '@goblin/schema';
import * as db from '../db.ts';
import {
  diff_matches_claims, lens_coverage, refutation_attempted, review_verdict_consistent, tests_pass, type GateContext,
} from '../gates.ts';
import { commitAll, headSha, isClean, materializeDesign } from '../git.ts';
import { runPhase } from '../phase.ts';
import type { PhaseAttempt, PhaseContext, PhaseSpec } from '../pipeline.ts';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');

const REVIEWER_TOOLS = [
  'Read', 'Glob', 'Grep', 'Bash', 'Agent', 'TodoWrite', 'WebSearch', 'WebFetch',
];
/** The lenses that have a brief in the reviewer's prompt today. */
const SUPPORTED_LENSES = ['correctness', 'tests', 'maintainability', 'security', 'performance'];

/**
 * Reviews the branch through isolated lenses, refutes what it finds, and either
 * sends the ticket on or hands the blocking findings back to the builder's own
 * session — a correction, not a restart — for as many loops as policy allows.
 */
export const reviewerPhase: PhaseSpec<ReviewOutput> = {
  name: 'reviewer',
  kind: 'agent',
  agentName: 'reviewer',
  envelope: 'ReviewOutput',
  gates: [review_verdict_consistent, lens_coverage, refutation_attempted],
  modelFor: policy => ({
    harness: policy.models.reviewer?.harness ?? 'claude-code',
    model: policy.models.reviewer?.model ?? 'opus',
    effort: policy.models.reviewer?.effort ?? 'high',
  }),
  run: runReviewer,
};

async function runReviewer(
  ctx: PhaseContext, _handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<ReviewOutput>> {
  const { claim, runId, phaseId, worktree } = ctx;
  if (!worktree) throw new Error('reviewer phase requires a worktree');

  const lenses = (claim.policy.review.lenses ?? [])
    .filter(l => SUPPORTED_LENSES.includes(l.toLowerCase()));
  const blockOn = claim.policy.review.blockOn ?? 'important';
  const maxLoops = claim.policy.review.maxFixLoops ?? 3;

  const designPath = claim.designMarkdown
    ? await materializeDesign(worktree.path, claim.designMarkdown)
    : '';
  if (designPath) {
    await db.event({ runId, phaseId, type: 'log', name: 'design materialized',
                     payload: { path: relative(worktree.path, designPath), design_id: claim.designId } });
  }

  const systemPrompt = await readFile(join(promptsDir, 'reviewer.md'), 'utf8');
  const schema = envelopeJsonSchema('ReviewOutput');
  const tier = claim.policy.models.reviewer;
  const phase = {
    runId, phaseId, agent: 'reviewer', cwd: worktree.path,
    harness: tier?.harness ?? 'claude-code',
    model: tier?.model ?? 'opus',
    effort: (tier?.effort ?? 'high') as 'high',
    maxTurns: tier?.maxTurns ?? 40,
    maxBudgetUsd: tier?.budgetUsd ?? 8,
    allowedTools: REVIEWER_TOOLS,
    protectedPaths: claim.policy.tools.protectedPaths ?? [],
    systemPrompt, jsonSchema: schema,
  };
  const gateCtx: GateContext = {
    worktree: worktree.path, base: worktree.baseSha,
    testCommand: claim.policy.commands.test ?? '', lenses, blockOn,
  };

  let prompt = firstPrompt(claim, lenses, designPath ? '.goblin/design.md' : null,
                           worktree.baseSha, schema);
  let resume: string | undefined;

  for (let loop = 0; ; loop++) {
    const pass = await onePass(ctx, phase, gateCtx, prompt, resume, loop);
    if (pass.status === 'fail') return pass;
    resume = pass.sessionId;
    const envelope = pass.envelope;

    const blocking = blockingFindings(envelope, blockOn);
    if (!blocking.length) {
      await db.event({ runId, phaseId, type: 'log', name: 'review clean',
                       payload: { loop, lenses, findings: envelope.findings.length,
                                  refuted: envelope.findings.filter(f => f.refuted).length } });
      return { status: 'success', envelope };
    }

    if (loop >= maxLoops) {
      await db.event({ runId, phaseId, type: 'error', name: 'fix loops exhausted',
                       payload: { loops: loop, max: maxLoops, blocking: blocking.map(describe) } });
      return { status: 'fail', envelope, reason: 'review_blocked' };
    }

    const fixed = await runBuilderFix(ctx, blocking, loop + 1);
    if (!fixed.ok) return { status: 'fail', envelope, reason: fixed.reason };

    prompt = [
      `The builder has answered your findings (fix loop ${loop + 1} of ${maxLoops}).`,
      'Review the branch again from the top — same lenses, same isolation, same refutation pass.',
      'Judge the code as it stands now, not the promise in its handoff:',
      '',
      fixed.handoff.slice(0, 4000),
      '',
      'Then re-emit ONLY the report JSON.',
    ].join('\n');
  }
}

type Pass =
  | { status: 'success'; envelope: ReviewOutput; sessionId: string }
  | { status: 'fail'; envelope: ReviewOutput | null; reason: string };

/** One review: the agent, its envelope, and the gates that check its verdict. */
async function onePass(
  ctx: PhaseContext, phase: Parameters<typeof runPhase>[0], gateCtx: GateContext,
  firstPrompt: string, resume: string | undefined, loop: number,
): Promise<Pass> {
  const { claim, runId, phaseId } = ctx;
  const maxAttempts = (claim.policy.budgets.gateRetries ?? 2) + 1;
  let prompt = firstPrompt;
  let session = resume;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await db.updatePhase(phaseId, { attempt: loop * maxAttempts + attempt });
    const result = await runPhase(phase, prompt, session);
    session = result.sessionId;

    const parsed = reviewOutput.safeParse(result.structured ?? tryJson(result.text));
    if (!parsed.success) {
      await db.saveEnvelope(phaseId, 'reviewer', 'ReviewOutput', result.structured ?? null,
                            false, attempt, result.text.slice(0, 8000));
      await db.event({ runId, phaseId, type: 'error', name: 'invalid envelope',
                       payload: { error: parsed.error.message.slice(0, 2000) } });
      prompt = `Your report was not a valid ReviewOutput (${parsed.error.message.slice(0, 500)}).`
        + ' Respond again with ONLY the report JSON.';
      continue;
    }
    const envelope = parsed.data;
    await db.saveEnvelope(phaseId, 'reviewer', 'ReviewOutput', envelope, true, attempt, null);
    await db.event({ runId, phaseId, type: 'handoff', name: 'ReviewOutput',
                     payload: { verdict: envelope.verdict, lenses_run: envelope.lenses_run,
                                findings: envelope.findings.map(describe) } });

    const failed: string[] = [];
    for (const gate of reviewerPhase.gates) {
      const gateReport = await gate(envelope, gateCtx);
      await db.saveGate(phaseId, attempt, gateReport);
      await db.event({
        runId, phaseId, type: gateReport.passed ? 'gate_pass' : 'gate_fail', name: gateReport.gate,
        payload: { attempt, loop, checks: gateReport.checks, violations: violations(gateReport) },
      });
      failed.push(...violations(gateReport));
    }
    if (!failed.length) return { status: 'success', envelope, sessionId: session };

    if (attempt === maxAttempts) {
      await db.event({ runId, phaseId, type: 'error', name: 'gates exhausted',
                       payload: { attempts: attempt, violations: failed } });
      return { status: 'fail', envelope, reason: 'gates_failed' };
    }
    prompt = `Your review failed the harness gates:\n- ${failed.join('\n- ')}\n\n`
      + 'Fix the report — run the lens or gather the evidence you are missing — then re-emit ONLY the report JSON.';
  }
  return { status: 'fail', envelope: null, reason: 'no_envelope' };
}

/**
 * Blocking findings go back to the builder's own session, which still remembers
 * why it wrote what it wrote. Its own gates run again on the result, because a
 * fix that breaks the tests is not a fix.
 */
async function runBuilderFix(
  ctx: PhaseContext, blocking: Finding[], loop: number,
): Promise<{ ok: true; handoff: string } | { ok: false; reason: string }> {
  const { claim, runId, worktree } = ctx;
  // A correction is measured from where the branch stood when it started, not
  // from the branch's base: the fix changed four files, and diffing against the
  // base blamed it for every commit the ticket had ever made.
  const fixBase = await headSha(worktree!.path);
  const session = await db.lastBuilderSession(claim.ticketId);
  const tier = claim.policy.models.builder;
  const seq = await db.nextPhaseSeq(runId);
  const phaseId = await db.startPhase(runId, seq, 'agent', `builder_fix_${loop}`, 'builder',
                                      tier?.model ?? 'sonnet', tier?.effort ?? 'xhigh');
  await db.event({ runId, phaseId, type: 'phase_start', name: `builder_fix_${loop}`,
                   payload: { kind: 'agent', resumed: session ?? null, base_sha: fixBase,
                              blocking: blocking.map(describe) } });

  const systemPrompt = await readFile(join(promptsDir, 'builder.md'), 'utf8');
  const schema = envelopeJsonSchema('BuildOutput');
  const phase = {
    runId, phaseId, agent: 'builder', cwd: worktree!.path,
    harness: tier?.harness ?? 'claude-code',
    model: tier?.model ?? 'sonnet',
    effort: (tier?.effort ?? 'xhigh') as 'xhigh',
    maxTurns: tier?.maxTurns ?? 80,
    maxBudgetUsd: tier?.budgetUsd ?? 12,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'Agent',
                   'WebSearch', 'WebFetch'],
    protectedPaths: claim.policy.tools.protectedPaths ?? [],
    systemPrompt, jsonSchema: schema,
  };
  const prompt = [
    'The reviewer found problems in the branch you built. These block the ticket:',
    '',
    ...blocking.map(f => `- **${f.lens}** — ${f.requirement}\n  ${f.evidence}`),
    '',
    'Fix them in this worktree. Argue back in `deviations` if a finding is wrong,',
    'but fix it or explain it — silence reads as agreement that it is broken.',
    'Then re-emit ONLY the report JSON.',
  ].join('\n');

  const result = await runPhase(phase, prompt, session ?? undefined);
  const parsed = buildOutput.safeParse(result.structured ?? tryJson(result.text));
  if (!parsed.success) {
    await db.saveEnvelope(phaseId, 'builder', 'BuildOutput', result.structured ?? null, false, 1,
                          result.text.slice(0, 8000));
    await db.updatePhase(phaseId, { status: 'fail', error: 'invalid envelope' });
    await db.event({ runId, phaseId, type: 'phase_end', name: `builder_fix_${loop}`,
                     payload: { status: 'fail', reason: 'invalid_envelope' } });
    return { ok: false, reason: 'fix_invalid_envelope' };
  }
  const envelope: BuildOutput = parsed.data;
  await db.saveEnvelope(phaseId, 'builder', 'BuildOutput', envelope, true, 1, null);

  const gateCtx: GateContext = {
    worktree: worktree!.path, base: fixBase,
    testCommand: claim.policy.commands.test ?? '',
  };
  const failed: string[] = [];
  for (const gate of [tests_pass, diff_matches_claims]) {
    const gateReport = await gate(envelope, gateCtx);
    await db.saveGate(phaseId, 1, gateReport);
    await db.event({ runId, phaseId, type: gateReport.passed ? 'gate_pass' : 'gate_fail',
                     name: gateReport.gate, payload: { checks: gateReport.checks } });
    failed.push(...violations(gateReport));
  }
  const ok = envelope.status === 'success' && !failed.length;
  // Each loop lands as its own commit, so the next one measures from here and
  // the pull request shows what the review actually changed.
  if (ok && !(await isClean(worktree!.path))) {
    const commit = await commitAll(
      worktree!.path,
      envelope.commit_message || `${formatRef(claim.projectKey, claim.shortId)}: address review findings (loop ${loop})`,
      { ticket: formatRef(claim.projectKey, claim.shortId), run: runId,
        phase: `builder_fix_${loop}`, design: claim.designId },
    );
    await db.event({ runId, phaseId, type: 'log', name: 'fix commit',
                     payload: { code: commit.code, loop, out: commit.stdout.slice(-300) } });
  }
  await db.updatePhase(phaseId, { status: ok ? 'success' : 'fail', error: ok ? null : failed.join('; ').slice(0, 500) });
  await db.event({ runId, phaseId, type: 'phase_end', name: `builder_fix_${loop}`,
                   payload: { status: ok ? 'success' : 'fail', violations: failed } });
  return ok
    ? { ok: true, handoff: envelope.handoff || envelope.summary }
    : { ok: false, reason: 'fix_gates_failed' };
}

function describe(f: Finding): string {
  return `${f.lens}/${f.severity}${f.refuted ? ' (refuted)' : ''}: ${f.requirement}`;
}

function firstPrompt(
  claim: db.Claim, lenses: string[], designPath: string | null, base: string,
  schema: Record<string, unknown>,
): string {
  return [
    `## Ticket ${formatRef(claim.projectKey, claim.shortId)}: ${claim.title}`,
    '',
    claim.body || '(no description)',
    '',
    '## The change',
    '',
    `You are in the worktree holding this ticket's branch. The change under review is`,
    `everything since \`${base}\`: \`git diff ${base}\` and \`git log ${base}..HEAD\`.`,
    designPath
      ? `The approved design is at \`${designPath}\` — git-ignored, and the specification.`
      : 'There is no design for this ticket; the ticket body is the specification.',
    (claim.designNotes ?? []).length
      ? '\nThe human added these when approving the design; they carry the same weight as the design itself:\n'
        + (claim.designNotes ?? []).map(n => `- ${(n?.note ?? '').trim()}`).filter(s => s !== '- ').join('\n')
      : '',
    '',
    '## Lenses',
    '',
    lenses.length
      ? `Run exactly these, one isolated subagent each: ${lenses.join(', ')}.`
      : 'This project asks for no lenses; report an approve verdict with no findings.',
    '',
    '## Report',
    '',
    'End with ONLY this JSON object:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n');
}

function tryJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
