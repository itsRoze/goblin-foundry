import { createBuilder, defineQueries, defineQuery } from '@rocicorp/zero';
import { z } from 'zod';
import { schema } from './zero.ts';

/** Server-authoritative named queries. Clients send name + args, never ZQL —
    raw client ZQL is legacy in Zero 1.9 and no longer syncs rows. */
export const b = createBuilder(schema);

export const queries = defineQueries({
  statuses: defineQuery(() => b.status.where('enabled', true).orderBy('sortOrder', 'asc')),

  board: defineQuery(() =>
    b.ticket.related('runs', r => r.orderBy('startedAt', 'desc').limit(1))),

  ticket: defineQuery(z.object({ shortId: z.number() }), ({ args }) =>
    b.ticket.where('shortId', args.shortId)
      .related('status')
      .related('designs', d => d.orderBy('version', 'desc'))
      .related('runs', r => r.orderBy('startedAt', 'desc'))
      .related('comments', c => c.orderBy('createdAt', 'asc'))
      .limit(1)),

  run: defineQuery(z.object({ runId: z.string() }), ({ args }) =>
    b.run.where('id', args.runId)
      .related('ticket')
      .related('phases', p => p.orderBy('seq', 'asc').related('gates').related('envelopes'))
      .limit(1)),
});
