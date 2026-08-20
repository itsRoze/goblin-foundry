import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutput, envelopeJsonSchema, violations, type BuildOutput } from '@goblin/schema';
import * as db from './db.ts';
import {
  addWorktree, commitAll, hasCommitsSince, hasRemote, isClean, materializeDesign,
  pushAndOpenPr, removeWorktree,
} from './git.ts';
import { GATES } from './gates.ts';
import { runPhase } from './phase.ts';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

const BUILDER_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'Agent',
];

/** The whole builder phase: worktree → agent → envelope → gates → commit → PR. */
export async function build(claim: db.Claim): Promise<'success' | 'fail'> {
  const branch = `goblin/fac-${claim.shortId}`;
  const model = claim.policy.models.builder?.model ?? 'sonnet';
  const effort = claim.policy.models.builder?.effort ?? 'xhigh';
  const phaseId = await db.startPhase(claim.runId, 1, 'agent', 'builder', 'builder', model, effort);
  await db.event({ runId: claim.runId, phaseId, type: 'phase_start', name: 'builder',
                   payload: { kind: 'agent', owner: 'builder', ticket: `FAC-${claim.shortId}` } });

  let worktreePath = '';
  try {
    const worktree = await addWorktree(claim.repoPath, branch, claim.defaultBranch);
    worktreePath = worktree.path;
    await db.setRunBranch(claim.runId, worktree.path, branch);
    await db.event({ runId: claim.runId, phaseId, type: 'log', name: 'worktree',
                     payload: { path: worktree.path, branch, base: claim.defaultBranch, base_sha: worktree.baseSha } });

    // Designs are stored, never committed: the DB is the source, the worktree
    // gets a git-ignored copy so the agent can read it with plain file tools.
    const designPath = claim.designMarkdown
      ? await materializeDesign(worktree.path, claim.designMarkdown)
      : '';
    if (designPath) {
      await db.event({ runId: claim.runId, phaseId, type: 'log', name: 'design materialized',
                       payload: { path: relative(worktree.path, designPath), design_id: claim.designId } });
    }

    const systemPrompt = await readFile(join(promptsDir, 'builder.md'), 'utf8');
    const schema = envelopeJsonSchema('BuildOutput');
    const phase = {
      runId: claim.runId, phaseId, agent: 'builder', cwd: worktree.path, model,
      effort: effort as 'xhigh', maxTurns: claim.policy.models.builder?.maxTurns ?? 80,
      maxBudgetUsd: claim.policy.models.builder?.budgetUsd ?? 12,
      allowedTools: BUILDER_TOOLS, protectedPaths: claim.policy.tools.protectedPaths ?? [],
      systemPrompt, jsonSchema: schema,
    };

    const gateCtx = {
      worktree: worktree.path,
      base: worktree.baseSha,
      testCommand: claim.policy.commands.test ?? '',
    };

    let attempt = 1;
    let prompt = firstPrompt(claim, designPath ? '.goblin/design.md' : null, schema);
    let resume: string | undefined;
    let envelope: BuildOutput | undefined;

    const maxAttempts = (claim.policy.budgets.gateRetries ?? 2) + 1;
    for (; attempt <= maxAttempts; attempt++) {
      await db.updatePhase(phaseId, { attempt });
      const result = await runPhase(phase, prompt, resume);
      resume = result.sessionId;

      const parsed = buildOutput.safeParse(result.structured ?? tryJson(result.text));
      if (!parsed.success) {
        await db.saveEnvelope(phaseId, 'builder', 'BuildOutput', result.structured ?? null,
                              false, attempt, result.text.slice(0, 8000));
        await db.event({ runId: claim.runId, phaseId, type: 'error', name: 'invalid envelope',
                         payload: { error: parsed.error.message.slice(0, 2000), terminal_reason: result.terminalReason } });
        prompt = `Your report was not a valid BuildOutput (${parsed.error.message.slice(0, 500)}).`
          + ' Respond again with ONLY the report JSON.';
        continue;
      }
      envelope = parsed.data;
      await db.saveEnvelope(phaseId, 'builder', 'BuildOutput', envelope, true, attempt, null);
      await db.event({ runId: claim.runId, phaseId, type: 'handoff', name: 'BuildOutput',
                       payload: { summary: envelope.summary, artifacts: envelope.artifacts,
                                  changed_files: envelope.changed_files } });

      if (envelope.status === 'fail') {
        await db.event({ runId: claim.runId, phaseId, type: 'error', name: 'builder reported failure',
                         payload: { summary: envelope.summary, notes: envelope.notes_for_next_agent } });
        await finish(claim, phaseId, 'fail', 'builder_reported_fail', worktreePath);
        return 'fail';
      }

      const failed: string[] = [];
      for (const gate of GATES) {
        const gateReport = await gate(envelope, gateCtx);
        await db.saveGate(phaseId, attempt, gateReport);
        await db.event({
          runId: claim.runId, phaseId,
          type: gateReport.passed ? 'gate_pass' : 'gate_fail', name: gateReport.gate,
          payload: { attempt, checks: gateReport.checks, violations: violations(gateReport) },
        });
        failed.push(...violations(gateReport));
      }
      if (!failed.length) break;

      if (attempt === maxAttempts) {
        await db.event({ runId: claim.runId, phaseId, type: 'error', name: 'gates exhausted',
                         payload: { attempts: attempt, violations: failed } });
        await finish(claim, phaseId, 'fail', 'gates_failed', worktreePath);
        return 'fail';
      }
      // Correction, not restart: the same session hears the named violations.
      prompt = `Your work failed the harness gates:\n- ${failed.join('\n- ')}\n\n`
        + 'Fix these problems in the worktree, then re-emit ONLY the report JSON.';
    }

    if (!envelope) {
      await finish(claim, phaseId, 'fail', 'no_envelope', worktreePath);
      return 'fail';
    }

    // Fold the attempt into one commit that carries the provenance trailers,
    // whether the builder committed as it went or left everything staged.
    if (!(await isClean(worktree.path)) || await hasCommitsSince(worktree.path, worktree.baseSha)) {
      const commit = await commitAll(
        worktree.path,
        envelope.commit_message || `FAC-${claim.shortId}: ${claim.title}`,
        { ticket: `FAC-${claim.shortId}`, run: claim.runId, phase: `builder/${attempt}`,
          design: claim.designId },
        worktree.baseSha,
      );
      await db.event({ runId: claim.runId, phaseId, type: 'log', name: 'commit',
                       payload: { code: commit.code, out: commit.stdout.slice(-500) } });
    }

    const prBody = prBodyFor(claim, envelope, attempt);
    if (await hasRemote(claim.repoPath)) {
      const pr = await pushAndOpenPr(worktree.path, branch, claim.defaultBranch,
        `FAC-${claim.shortId}: ${claim.title}`, prBody);
      await db.event({ runId: claim.runId, phaseId, type: pr.ok ? 'log' : 'error',
                       name: pr.ok ? 'pull request' : 'pr failed',
                       payload: { url: pr.url, detail: pr.detail } });
    } else {
      await db.event({ runId: claim.runId, phaseId, type: 'log', name: 'no remote',
                       payload: { branch, note: 'branch left local; add a git remote to open PRs',
                                  pr_body: prBody } });
    }

    await finish(claim, phaseId, 'success', 'completed', worktreePath);
    return 'success';
  } catch (e) {
    await db.event({ runId: claim.runId, phaseId, type: 'error', name: 'worker error',
                     payload: { error: (e as Error).message, stack: (e as Error).stack?.slice(0, 2000) } });
    await finish(claim, phaseId, 'fail', 'worker_error', worktreePath);
    return 'fail';
  }
}

async function finish(
  claim: db.Claim, phaseId: string, status: 'success' | 'fail', reason: string, worktree: string,
) {
  await db.updatePhase(phaseId, { status: status === 'success' ? 'success' : 'fail', error: status === 'fail' ? reason : null });
  await db.event({ runId: claim.runId, phaseId, type: 'phase_end', name: 'builder', payload: { status, reason } });
  await db.finishRun(claim.runId, status, reason);
  // A failed run leaves the ticket in `building` with the failure attached: it
  // needs you, and moving it back to the queue would just re-claim it forever.
  if (status === 'success') await db.moveTicket(claim.ticketId, claim.projectId, 'in_review', null);
  else await db.clearDelegate(claim.ticketId);
  // `-p` runs never clean up their worktrees; keep failures around to inspect.
  if (status === 'success' && worktree) await removeWorktree(claim.repoPath, worktree);
}

function firstPrompt(claim: db.Claim, designPath: string | null, schema: Record<string, unknown>): string {
  return [
    `## Ticket FAC-${claim.shortId}: ${claim.title}`,
    '',
    claim.body || '(no description)',
    '',
    designPath
      ? `## Design\n\nThe approved design is at \`${designPath}\` in this worktree. Read it before you start. It is git-ignored — never commit it.`
      : '## Design\n\nThere is no design for this ticket. Implement the ticket body directly, and keep the change minimal.',
    '',
    '## Task',
    '',
    'Implement this ticket in the current worktree. You are already on the ticket branch.',
    'Commit as you go if it helps you work; the harness folds the attempt into one commit',
    'carrying the ticket, run, phase and design ids, so do not craft the final history yourself.',
    '',
    '## Report',
    '',
    'End with ONLY this JSON object:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n');
}

function prBodyFor(claim: db.Claim, env: BuildOutput, attempts: number): string {
  return [
    `## FAC-${claim.shortId}: ${claim.title}`,
    '', env.summary, '',
    '### Evidence',
    ...env.evidence.map(e => `- **${e.what}** — \`${e.command}\`\n  \n  \`\`\`\n  ${e.output.slice(0, 600)}\n  \`\`\``),
    '',
    env.deviations.length ? `### Deviations\n${env.deviations.map(d => `- ${d}`).join('\n')}` : '',
    '',
    '### Handoff', env.handoff, '',
    '### Provenance',
    `- Run \`${claim.runId}\` · builder attempt ${attempts}`,
    claim.designId ? `- Design \`${claim.designId}\` (stored in the factory DB, not in this repo)` : '',
  ].filter(Boolean).join('\n');
}

function tryJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
