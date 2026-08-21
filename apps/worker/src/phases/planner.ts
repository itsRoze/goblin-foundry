import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  envelopeJsonSchema, planOutput, violations, type EnvelopeBase, type PlanOutput,
} from '@goblin/schema';
import * as db from '../db.ts';
import { design_complete, review_readable, verdict_consistent } from '../gates.ts';
import { runPhase } from '../phase.ts';
import type { PhaseAttempt, PhaseContext, PhaseSpec } from '../pipeline.ts';

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, '..', '..', 'prompts');
// One design template for the whole factory: the terminal skill and this phase
// read the same file, so the two planners cannot drift apart.
const templatePath = join(here, '..', '..', '..', '..', 'packages', 'skills', 'plan', 'design-template.md');

/**
 * The planner reads and asks; it never writes. `Agent` is here for the
 * three-perspective pass, `AskUserQuestion` for the grill rounds.
 */
const PLANNER_TOOLS = [
  'Read', 'Glob', 'Grep', 'Agent', 'AskUserQuestion', 'TodoWrite', 'WebSearch', 'WebFetch',
];

/** Interrogates you, then writes the design the builder will work from. */
export const plannerPhase: PhaseSpec<PlanOutput> = {
  name: 'planner',
  kind: 'agent',
  agentName: 'planner',
  envelope: 'PlanOutput',
  gates: [design_complete, review_readable, verdict_consistent],
  modelFor: policy => ({
    model: policy.models.planner?.model ?? 'opus',
    effort: policy.models.planner?.effort ?? 'high',
  }),
  run: runPlanner,
};

async function runPlanner(
  ctx: PhaseContext, _handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<PlanOutput>> {
  const { claim, runId, phaseId } = ctx;
  const tier = claim.policy.models.planner;

  const [systemPrompt, template, prior, answered] = await Promise.all([
    readFile(join(promptsDir, 'planner.md'), 'utf8'),
    readFile(templatePath, 'utf8'),
    db.latestDesign(claim.ticketId),
    db.answeredQuestions(claim.ticketId),
  ]);
  const schema = envelopeJsonSchema('PlanOutput');
  const phase = {
    runId, phaseId, agent: 'planner', cwd: claim.repoPath,
    model: tier?.model ?? 'opus',
    effort: (tier?.effort ?? 'high') as 'high',
    maxTurns: tier?.maxTurns ?? 60,
    maxBudgetUsd: tier?.budgetUsd ?? 6,
    allowedTools: PLANNER_TOOLS,
    // Nothing in the repository is the planner's to change; the tool list is the
    // boundary, and the protected paths are what the guard denies outright.
    protectedPaths: claim.policy.tools.protectedPaths ?? [],
    systemPrompt, jsonSchema: schema, askHuman: true,
  };

  let attempt = 1;
  let prompt = firstPrompt(claim, template, schema, prior, answered);
  let resume: string | undefined;
  let envelope: PlanOutput | undefined;
  let gatesGreen = false;

  const maxAttempts = (claim.policy.budgets.gateRetries ?? 2) + 1;
  for (; attempt <= maxAttempts; attempt++) {
    await db.updatePhase(phaseId, { attempt });
    const result = await runPhase(phase, prompt, resume);
    resume = result.sessionId;

    const parsed = planOutput.safeParse(result.structured ?? tryJson(result.text));
    if (!parsed.success) {
      await db.saveEnvelope(phaseId, 'planner', 'PlanOutput', result.structured ?? null,
                            false, attempt, result.text.slice(0, 8000));
      await db.event({ runId, phaseId, type: 'error', name: 'invalid envelope',
                       payload: { error: parsed.error.message.slice(0, 2000), terminal_reason: result.terminalReason } });
      prompt = `Your report was not a valid PlanOutput (${parsed.error.message.slice(0, 500)}).`
        + ' Respond again with ONLY the report JSON.';
      continue;
    }
    envelope = parsed.data;
    await db.saveEnvelope(phaseId, 'planner', 'PlanOutput', envelope, true, attempt, null);
    await db.event({ runId, phaseId, type: 'handoff', name: 'PlanOutput',
                     payload: { summary: envelope.summary, open_questions: envelope.open_questions,
                                design_chars: envelope.design_markdown.length,
                                review_chars: envelope.review_html.length } });

    if (envelope.status === 'fail') {
      await db.event({ runId, phaseId, type: 'error', name: 'planner reported failure',
                       payload: { summary: envelope.summary, notes: envelope.notes_for_next_agent } });
      return { status: 'fail', envelope, reason: 'planner_reported_fail' };
    }

    const failed: string[] = [];
    for (const gate of plannerPhase.gates) {
      const gateReport = await gate(envelope, { worktree: claim.repoPath, base: '', testCommand: '' });
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
    // Correction, not restart: the same session hears what the gate found.
    prompt = `Your design did not pass the harness gates:\n- ${failed.join('\n- ')}\n\n`
      + 'Fix the design — ask me another question round if the gap is something only I can settle —'
      + ' then re-emit ONLY the report JSON with the whole design in `design_markdown`.';
  }

  if (!envelope || !gatesGreen) {
    await db.event({ runId, phaseId, type: 'error', name: 'attempts exhausted',
                     payload: { attempts: attempt - 1, had_envelope: Boolean(envelope) } });
    return { status: 'fail', envelope: envelope ?? null, reason: envelope ? 'gates_failed' : 'no_envelope' };
  }

  return { status: 'success', envelope };
}

function firstPrompt(
  claim: db.Claim, template: string, schema: Record<string, unknown>, prior?: db.PriorDesign,
  answered: { header: string; prompt: string; answer: string }[] = [],
): string {
  return [
    `## Ticket FAC-${claim.shortId}: ${claim.title}`,
    '',
    claim.body || '(no description)',
    '',
    '## Repository',
    '',
    `You are standing in \`${claim.repoPath}\`, the repository this ticket belongs to.`,
    'Read it before you ask me anything. You have no write tools, and you need none.',
    prior
      ? `\n## Design v${prior.version}, and what I said about it\n\n`
        + 'You are writing the next version. Start from what it said, and treat my'
        + ' annotations below as the round I already answered — do not ask them back to me.\n\n'
        + (prior.notes.length
            ? prior.notes.map(n => `- ${n.note}`).join('\n') + '\n\n'
            : '_No annotations; it was sent back without notes._\n\n')
        + '```markdown\n' + prior.markdown.slice(0, 20000) + '\n```'
      : '',
    // A run that died mid-interview must not cost the human the interview.
    answered.length
      ? '\n## What you have already asked me, and what I said\n\n'
        + 'These are settled. Do not ask them again; ask only what is still open.\n\n'
        + answered.map(q => `**${q.header || 'Q'}** — ${q.prompt}\n> ${q.answer}`).join('\n\n')
      : '',
    '',
    '## Design template',
    '',
    'Follow this template, section for section:',
    '',
    '```markdown',
    template,
    '```',
    '',
    '## Report',
    '',
    'End with ONLY this JSON object:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].filter(Boolean).join('\n');
}

function tryJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
