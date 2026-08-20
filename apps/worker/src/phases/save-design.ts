import type { EnvelopeBase, PlanOutput } from '@goblin/schema';
import * as db from '../db.ts';
import type { PhaseAttempt, PhaseContext, PhaseSpec } from '../pipeline.ts';

/**
 * Stores the design the planner wrote as the ticket's next version and points
 * this run at it. Designs are stored, never committed: this is the only place a
 * planner run leaves anything behind, and it is a database row.
 */
export const saveDesignPhase: PhaseSpec<EnvelopeBase> = {
  name: 'save_design',
  kind: 'code',
  agentName: null,
  envelope: 'GenericOutput',
  gates: [],
  run: runSaveDesign,
};

async function runSaveDesign(
  ctx: PhaseContext, handoff: EnvelopeBase | null,
): Promise<PhaseAttempt<EnvelopeBase>> {
  const { claim, runId, phaseId } = ctx;
  const plan = handoff as PlanOutput | null;
  if (!plan?.design_markdown) {
    return { status: 'fail', envelope: null, reason: 'no_design_to_save' };
  }

  const design = await db.createDesign(
    claim.ticketId, plan.design_markdown, plan.review_html || null, 'planner');
  await db.setRunDesign(runId, design.id);
  await db.event({
    runId, phaseId, type: 'log', name: 'design saved',
    payload: { design_id: design.id, version: design.version,
               chars: plan.design_markdown.length, review_chars: plan.review_html.length },
  });

  return {
    status: 'success',
    envelope: {
      status: 'success',
      summary: `design v${design.version} saved and waiting for your review`,
      artifacts: [design.id],
      notes_for_next_agent: plan.notes_for_next_agent,
    },
  };
}
