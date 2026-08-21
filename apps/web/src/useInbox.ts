import { useMemo } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { TRIGGER_STAGES } from '@goblin/schema';
import { approvalsFrom, roundsFrom, sectionize, stuckFrom, type InboxSections } from './inbox.ts';

export { inboxCount } from './inbox.ts';

/** The one path the topbar badge and the inbox page both read, so they can never disagree. */
export function useInboxSections(): InboxSections {
  const [questions] = useQuery(useMemo(() => queries.openQuestions(), []));
  const [designs] = useQuery(useMemo(() => queries.pendingApprovals(), []));
  const [tickets] = useQuery(useMemo(() => queries.stuckCandidates(), []));
  const [statuses] = useQuery(useMemo(() => queries.statuses(), []));

  const rounds = useMemo(() => roundsFrom(questions), [questions]);
  const approvals = useMemo(() => approvalsFrom(designs), [designs]);
  const stuck = useMemo(() => stuckFrom(tickets, TRIGGER_STAGES, statuses), [tickets, statuses]);
  return useMemo(() => sectionize(rounds, approvals, stuck), [rounds, approvals, stuck]);
}
