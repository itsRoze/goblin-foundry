import type { StatusKind } from '@goblin/schema';
import { commitAndPrPhase } from './phases/commit-pr.ts';
import { builderPhase } from './phases/builder.ts';
import type { Pipeline } from './pipeline.ts';

/**
 * Which pipeline a claimed ticket runs, keyed by the trigger status it was
 * claimed from. One entry today: Ready for Dev builds, then commits and opens
 * the pull request, finishing in In Review.
 */
export const TRIGGER_PIPELINES: Partial<Record<StatusKind, Pipeline>> = {
  ready_for_dev: {
    phases: [builderPhase, commitAndPrPhase],
    success: 'in_review',
    worktree: 'fresh',
  },
};
