import type { StatusKind } from '@goblin/schema';
import { commitAndPrPhase } from './phases/commit-pr.ts';
import { builderPhase } from './phases/builder.ts';
import { plannerPhase } from './phases/planner.ts';
import { saveDesignPhase } from './phases/save-design.ts';
import type { Pipeline } from './pipeline.ts';

/**
 * Which pipeline a claimed ticket runs, keyed by the trigger status it was
 * claimed from. Ready for Design plans and saves the design; Ready for Dev
 * builds, then commits and opens the pull request.
 */
export const TRIGGER_PIPELINES: Partial<Record<StatusKind, Pipeline>> = {
  ready_for_design: {
    phases: [plannerPhase, saveDesignPhase],
    working: 'designing',
    delegate: 'planner',
    success: 'design_review',
    // The planner reads the repository and writes nothing into it, so it works
    // in the repo itself rather than paying for a worktree it cannot use.
    worktree: 'none',
  },
  ready_for_dev: {
    phases: [builderPhase, commitAndPrPhase],
    working: 'building',
    delegate: 'builder',
    success: 'in_review',
    worktree: 'fresh',
  },
};
