import type { StatusKind } from './types.ts';

/**
 * A status kind that claims and runs a ticket has a working status shown
 * while the run is in flight, a delegate shown on its card, and a success
 * status it lands in once every phase passes. The worker's pipelines read
 * this table instead of restating it, and the inbox's stuck predicate
 * depends on it too — a ticket is stuck when it is sitting in a trigger's
 * working status after that trigger's run has ended.
 */
export type TriggerStage = {
  working: StatusKind;
  delegate: string;
  success: StatusKind;
};

export const TRIGGER_STAGES: Partial<Record<StatusKind, TriggerStage>> = {
  ready_for_design: { working: 'designing', delegate: 'planner', success: 'design_review' },
  ready_for_dev: { working: 'building', delegate: 'builder', success: 'in_review' },
  in_review: { working: 'in_review', delegate: 'reviewer', success: 'ready_to_merge' },
};
