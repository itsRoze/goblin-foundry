import { useMemo } from 'react';
import { useQuery } from '@rocicorp/zero/react';
import { queries } from '@goblin/schema/queries';
import { TRIGGER_STAGES } from '@goblin/schema';
import { approvalsFrom, parseItemId, roundsFrom, sectionize, stuckFrom, type InboxSections } from './inbox.ts';

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

export type MissingItemTicket = { key: string; shortId: number; title: string };

/**
 * Resolves the ticket a no-longer-waiting inbox item belonged to. Called
 * unconditionally regardless of whether `itemId` is currently missing —
 * hooks can't be called conditionally — so each of the three queries below
 * is scoped to an empty id (matching nothing) whenever it is not the kind
 * `itemId` names.
 */
export function useMissingItemTicket(itemId: string | undefined): MissingItemTicket | null {
  const parsed = itemId ? parseItemId(itemId) : null;
  const phaseId = parsed?.kind === 'round' ? parsed.id : '';
  const designId = parsed?.kind === 'approval' ? parsed.id : '';
  const ticketId = parsed?.kind === 'stuck' ? parsed.id : '';

  const [phaseRows] = useQuery(useMemo(() => queries.phaseTicket({ phaseId }), [phaseId]));
  const [designRows] = useQuery(useMemo(() => queries.designTicket({ designId }), [designId]));
  const [ticketRows] = useQuery(useMemo(() => queries.ticketById({ ticketId }), [ticketId]));

  const ticket = phaseRows[0]?.run?.ticket ?? designRows[0]?.ticket ?? ticketRows[0];
  if (!ticket?.project) return null;
  return { key: ticket.project.key, shortId: ticket.shortId, title: ticket.title };
}
