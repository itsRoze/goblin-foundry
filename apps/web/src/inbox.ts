/**
 * The inbox derivation now lives in @goblin/schema so the notifier can share
 * it — see packages/schema/src/inbox.ts. This is a thin re-export so the
 * app's existing imports (`from './inbox.ts'` / `from '../inbox.ts'`) keep
 * working unchanged.
 */
export {
  groupByPhase, roundsFrom, isStale, approvalsFrom, stuckFrom, sectionize, inboxCount,
  buildItemId, parseItemId,
  type ItemKind, type RunStatus, type QuestionRow, type Round, type ApprovalDesignRow, type Approval,
  type StuckStatusRow, type StuckTicketRow, type Stuck, type InboxSections,
} from '@goblin/schema';
