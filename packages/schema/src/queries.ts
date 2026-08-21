import { createBuilder, defineQueries, defineQuery } from '@rocicorp/zero';
import { z } from 'zod';
import { schema } from './zero.ts';

/** Server-authoritative named queries. Clients send name + args, never ZQL —
    raw client ZQL is legacy in Zero 1.9 and no longer syncs rows. */
export const b = createBuilder(schema);

export const queries = defineQueries({
  statuses: defineQuery(() => b.status.where('enabled', true).orderBy('sortOrder', 'asc')),

  board: defineQuery(() =>
    b.ticket.related('project').related('status')
      .related('runs', r => r.orderBy('startedAt', 'desc').limit(1)
        .related('questions', q => q.where('answeredAt', 'IS', null)))),

  /** By canonical ref (`key` + `shortId`) or, for a legacy `#/t/<n>` link, by
      `shortId` alone — which may match more than one project, and the caller
      decides what to do with that. */
  ticket: defineQuery(z.object({ shortId: z.number(), key: z.string().optional() }), ({ args }) => {
    let q = b.ticket.where('shortId', args.shortId);
    if (args.key) q = q.whereExists('project', p => p.where('key', args.key!.toUpperCase()));
    return q
      .related('project')
      .related('status')
      .related('designs', d => d.orderBy('version', 'desc'))
      .related('runs', r => r.orderBy('startedAt', 'desc')
        .related('questions', q => q.orderBy('askedAt', 'asc').orderBy('seq', 'asc')))
      .related('comments', c => c.orderBy('createdAt', 'asc'))
      .limit(5);
  }),

  /**
   * The inbox's rounds: every unanswered question, with its phase (for the
   * asking agent's name), its run and, through the run, its ticket and the
   * ticket's project.
   */
  openQuestions: defineQuery(() =>
    b.question.where('answeredAt', 'IS', null).orderBy('askedAt', 'desc')
      .related('phase')
      .related('run', r => r.related('ticket', t => t.related('project')))),

  /** The inbox's approvals: every design still awaiting a decision. */
  pendingApprovals: defineQuery(() =>
    b.design.where('status', 'in_review').orderBy('createdAt', 'desc')
      .related('ticket', t => t.related('project'))),

  /**
   * The inbox's stuck candidates: every ticket with its status, its project,
   * and its single most recent run — rooted at the ticket with a one-run
   * limit, the same shape as `board`, so a ticket restarted after a canceled
   * run is judged on the run that replaced it, never the one it replaced.
   */
  stuckCandidates: defineQuery(() =>
    b.ticket.related('project').related('status')
      .related('runs', r => r.orderBy('startedAt', 'desc').limit(1))),

  run: defineQuery(z.object({ runId: z.string() }), ({ args }) =>
    b.run.where('id', args.runId)
      .related('ticket', t => t.related('project'))
      .related('phases', p => p.orderBy('seq', 'asc').related('gates').related('envelopes')
        .related('questions', q => q.orderBy('seq', 'asc')))
      .limit(1)),
});
