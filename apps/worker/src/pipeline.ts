import type { EnvelopeBase, EnvelopeName, PaymentMethod, Policy, StatusKind } from '@goblin/schema';
import type { Claim } from './db.ts';
import type { Gate } from './gates.ts';
import type { Worktree } from './git.ts';

/** How a run obtains the worktree its phases work in. */
export type WorktreeMode = 'fresh' | 'attached' | 'none';

export type PhaseContext = {
  claim: Claim;
  runId: string;
  phaseId: string;
  worktree: Worktree | null;
};

export type PhaseAttempt<E extends EnvelopeBase = EnvelopeBase> =
  | { status: 'success'; envelope: E }
  | { status: 'fail'; envelope: E | null; reason: string };

/**
 * One step in a pipeline: its name, whether it runs an agent or deterministic
 * code, the envelope it reports, and the gates that verify that envelope —
 * a phase's own, never a list shared with any other phase.
 */
export type PhaseSpec<E extends EnvelopeBase = EnvelopeBase> = {
  name: string;
  kind: 'agent' | 'code';
  agentName: string | null;
  envelope: EnvelopeName;
  gates: Gate<E>[];
  /** Agent phases only: which model tier in policy this phase draws from. */
  modelFor?: (policy: Policy) => {
    model: string; effort: string; harness?: string; provider?: string; paidBy?: PaymentMethod;
  };
  run: (ctx: PhaseContext, handoff: EnvelopeBase | null) => Promise<PhaseAttempt<E>>;
};

/**
 * An ordered list of phases, the status kind a ticket sits in while they run,
 * the kind it moves to once every phase succeeds, and how the run obtains its
 * worktree. `delegate` is the goblin the board shows on the card meanwhile.
 */
export type Pipeline = {
  phases: PhaseSpec<any>[];
  working: StatusKind;
  delegate: string;
  success: StatusKind;
  worktree: WorktreeMode;
};

/** Looks a pipeline up by the trigger status kind a ticket was claimed from. */
export function pipelineFor(
  pipelines: Partial<Record<StatusKind, Pipeline>>, kind: string,
): Pipeline | undefined {
  return pipelines[kind as StatusKind];
}

/** Numbers a pipeline's phases by their position, starting at 1. */
export function numberedPhases(pipeline: Pipeline): { spec: PhaseSpec<any>; seq: number }[] {
  return pipeline.phases.map((spec, i) => ({ spec, seq: i + 1 }));
}

/** A terminal reason that names which phase produced it, e.g. "builder:gates_failed". */
export function phaseTerminalReason(phaseName: string, reason: string): string {
  return `${phaseName}:${reason}`;
}

/**
 * A fresh worktree is left behind on failure so it can be inspected, and
 * removed once every phase succeeds. An attached worktree is the ticket's own
 * branch, not this run's to remove. 'none' never has one to keep.
 */
export function keepsWorktree(mode: WorktreeMode, outcome: 'success' | 'fail'): boolean {
  if (mode === 'none') return false;
  if (mode === 'attached') return true;
  return outcome === 'fail';
}
