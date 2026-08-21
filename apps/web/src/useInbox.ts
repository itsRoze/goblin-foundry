import { useMemo } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { TRIGGER_STAGES } from '@goblin/schema';
import { approvalsFrom, roundsFrom, sectionize, stuckFrom, type InboxSections } from './inbox.ts';

export { inboxCount } from './inbox.ts';

export type InboxData = { sections: InboxSections; loading: boolean };

/**
 * The one path the topbar badge and the inbox page both read, so they can
 * never disagree. Zero delivers rows incrementally — `result.type` for each
 * of the four queries only reaches 'complete' once its full result set has
 * synced, and `loading` stays true until all four have. Reading `sections`
 * before that would show "nothing waiting" or "item gone" for data that
 * simply has not arrived yet (see docs/LESSONS.md's useQuery note).
 */
export function useInboxSections(): InboxData {
  const [questions, qResult] = useQuery(useMemo(() => queries.openQuestions(), []));
  const [designs, dResult] = useQuery(useMemo(() => queries.pendingApprovals(), []));
  const [tickets, tResult] = useQuery(useMemo(() => queries.stuckCandidates(), []));
  const [statuses, sResult] = useQuery(useMemo(() => queries.statuses(), []));

  const loading = qResult.type !== 'complete' || dResult.type !== 'complete'
    || tResult.type !== 'complete' || sResult.type !== 'complete';

  const rounds = useMemo(() => roundsFrom(questions), [questions]);
  const approvals = useMemo(() => approvalsFrom(designs), [designs]);
  const stuck = useMemo(() => stuckFrom(tickets, TRIGGER_STAGES, statuses), [tickets, statuses]);
  const sections = useMemo(() => sectionize(rounds, approvals, stuck), [rounds, approvals, stuck]);

  return { sections, loading };
}
