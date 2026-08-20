import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOutput, envelopeJsonSchema, violations, type BuildOutput, type EnvelopeBase,
} from '@goblin/schema';
import * as db from '../db.ts';
import { diff_matches_claims, tests_pass } from '../gates.ts';
import { materializeDesign } from '../git.ts';
import { runPhase } from '../phase.ts';
import type { PhaseAttempt, PhaseContext, PhaseSpec } from '../pipeline.ts';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');

const BUILDER_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'Agent',
];

/** Implements the ticket in its worktree and reports a BuildOutput envelope. */
export const builderPhase: PhaseSpec<BuildOutput> = {
  name: 'builder',
  kind: 'agent',
  agentName: 'builder',
  envelope: 'BuildOutput',
  gates: [tests_pass, diff_matches_claims],
  modelFor: policy => ({
    model: policy.models.builder?.model ?? 'sonnet',
    effort: policy.models.builder?.effort ?? 'xhigh',
  }),
  run: runBuilder,
};

async function runBuilder(
  ctx: PhaseContext, _handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<BuildOutput>> {
  const { claim, runId, phaseId, worktree } = ctx;
  if (!worktree) throw new Error('builder phase requires a worktree');
  const model = claim.policy.models.builder?.model ?? 'sonnet';
  const effort = (claim.policy.models.builder?.effort ?? 'xhigh') as 'xhigh';

  // Designs are stored, never committed: the DB is the source, the worktree
  // gets a git-ignored copy so the agent can read it with plain file tools.
  const designPath = claim.designMarkdown
    ? await materializeDesign(worktree.path, claim.designMarkdown)
    : '';
  if (designPath) {
    await db.event({ runId, phaseId, type: 'log', name: 'design materialized',
                     payload: { path: relative(worktree.path, designPath), design_id: claim.designId } });
  }

  const systemPrompt = await readFile(join(promptsDir, 'builder.md'), 'utf8');
  const schema = envelopeJsonSchema('BuildOutput');
  const phase = {
    runId, phaseId, agent: 'builder', cwd: worktree.path, model,
    effort, maxTurns: claim.policy.models.builder?.maxTurns ?? 80,
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
  let gatesGreen = false;

  const maxAttempts = (claim.policy.budgets.gateRetries ?? 2) + 1;
  for (; attempt <= maxAttempts; attempt++) {
    await db.updatePhase(phaseId, { attempt });
    const result = await runPhase(phase, prompt, resume);
    resume = result.sessionId;

    const parsed = buildOutput.safeParse(result.structured ?? tryJson(result.text));
    if (!parsed.success) {
      await db.saveEnvelope(phaseId, 'builder', 'BuildOutput', result.structured ?? null,
                            false, attempt, result.text.slice(0, 8000));
      await db.event({ runId, phaseId, type: 'error', name: 'invalid envelope',
                       payload: { error: parsed.error.message.slice(0, 2000), terminal_reason: result.terminalReason } });
      prompt = `Your report was not a valid BuildOutput (${parsed.error.message.slice(0, 500)}).`
        + ' Respond again with ONLY the report JSON.';
      continue;
    }
    envelope = parsed.data;
    await db.saveEnvelope(phaseId, 'builder', 'BuildOutput', envelope, true, attempt, null);
    await db.event({ runId, phaseId, type: 'handoff', name: 'BuildOutput',
                     payload: { summary: envelope.summary, artifacts: envelope.artifacts,
                                changed_files: envelope.changed_files } });

    if (envelope.status === 'fail') {
      await db.event({ runId, phaseId, type: 'error', name: 'builder reported failure',
                       payload: { summary: envelope.summary, notes: envelope.notes_for_next_agent } });
      return { status: 'fail', envelope, reason: 'builder_reported_fail' };
    }

    const failed: string[] = [];
    for (const gate of builderPhase.gates) {
      const gateReport = await gate(envelope, gateCtx);
      await db.saveGate(phaseId, attempt, gateReport);
      await db.event({
        runId, phaseId,
        type: gateReport.passed ? 'gate_pass' : 'gate_fail', name: gateReport.gate,
        payload: { attempt, checks: gateReport.checks, violations: violations(gateReport) },
      });
      failed.push(...violations(gateReport));
    }
    if (!failed.length) { gatesGreen = true; break; }

    if (attempt === maxAttempts) {
      await db.event({ runId, phaseId, type: 'error', name: 'gates exhausted',
                       payload: { attempts: attempt, violations: failed } });
      return { status: 'fail', envelope, reason: 'gates_failed' };
    }
    // Correction, not restart: the same session hears the named violations.
    prompt = `Your work failed the harness gates:\n- ${failed.join('\n- ')}\n\n`
      + 'Fix these problems in the worktree, then re-emit ONLY the report JSON.';
  }

  // Running out of attempts on an unparseable report leaves `envelope` holding
  // an earlier attempt whose gates failed — never treat that as success.
  if (!envelope || !gatesGreen) {
    await db.event({ runId, phaseId, type: 'error', name: 'attempts exhausted',
                     payload: { attempts: attempt - 1, had_envelope: Boolean(envelope) } });
    return { status: 'fail', envelope: envelope ?? null, reason: envelope ? 'gates_failed' : 'no_envelope' };
  }

  return { status: 'success', envelope };
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

function tryJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
