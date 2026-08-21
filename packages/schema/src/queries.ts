import { createBuilder, defineQueries, defineQuery } from '@rocicorp/zero';
import { z } from 'zod';
import { schema } from './zero.ts';

/** Server-authoritative named queries. Clients send name + args, never ZQL —
    raw client ZQL is legacy in Zero 1.9 and no longer syncs rows. */
export const b = createBuilder(schema);

export const queries = defineQueries({
  statuses: defineQuery(() => b.status.where('enabled', true).orderBy('sortOrder', 'asc')),

  board: defineQuery(() =>
    b.ticket.related('project')
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

  /** Everything waiting on you: unanswered questions, newest first. */
  openQuestions: defineQuery(() =>
    b.question.where('answeredAt', 'IS', null).orderBy('askedAt', 'desc')
      .related('run', r => r.related('ticket'))),

  run: defineQuery(z.object({ runId: z.string() }), ({ args }) =>
    b.run.where('id', args.runId)
      .related('ticket', t => t.related('project'))
      .related('phases', p => p.orderBy('seq', 'asc').related('gates').related('envelopes')
        .related('questions', q => q.orderBy('seq', 'asc')))
      .limit(1)),
});
