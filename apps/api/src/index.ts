import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { statusKind } from '@goblin/schema';
import { schema } from '@goblin/schema/zero';
import { queries } from '@goblin/schema/queries';
import { handleQueryRequest } from '@rocicorp/zero/server';
import { mustGetQuery } from '@rocicorp/zero';
import { sql, findTicket, getTicket, moveTicket, createDesign, eventsAfter } from './db.ts';
import { onEvent } from './notify.ts';

const VERSION = '0.0.0';
const startedAt = Date.now();
const TOKEN = process.env.FOUNDRY_TOKEN ?? '';

const app = new Hono();
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }));

app.get('/healthz', async c => {
  let db = 'ok';
  try { await sql`select 1`; } catch (e) { db = `error: ${(e as Error).message}`; }
  return c.json({ status: db === 'ok' ? 'ok' : 'degraded', version: VERSION,
                  uptime_s: Math.round((Date.now() - startedAt) / 1000), db });
});

/** zero-cache asks us what a named query means; it authenticates with X-Api-Key. */
app.post('/zero/query', async c => {
  if (c.req.header('X-Api-Key') !== TOKEN) return c.json({ error: 'unauthorized' }, 401);
  const response = await handleQueryRequest({
    handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx: undefined } as never),
    schema,
    request: c.req.raw,
    userID: 'roze',
  });
  return c.json(response as never);
});

// Single user, single token. EventSource can't send headers, so ?token= is honored too.
app.use('/api/*', async (c, next) => {
  const header = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const token = header || c.req.query('token');
  if (!TOKEN || token !== TOKEN) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

app.get('/api/tickets/:ref', async c => {
  const found = await findTicket(c.req.param('ref'));
  if (!found.ok) return c.json(found.body, found.status);
  const ticket = found.ticket;
  const designs = await sql`select id, version, status, created_at, approved_at
    from design where ticket_id = ${ticket.id} order by version desc`;
  const runs = await sql`select id, status, branch, cost_usd, started_at, ended_at
    from run where ticket_id = ${ticket.id} order by started_at desc`;
  return c.json({ ticket, designs, runs });
});

const statusBody = z.object({ kind: statusKind });
app.post('/api/tickets/:ref/status', async c => {
  const found = await findTicket(c.req.param('ref'));
  if (!found.ok) return c.json(found.body, found.status);
  const ticket = found.ticket;
  const parsed = statusBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  await moveTicket(ticket.id, ticket.project_id, parsed.data.kind);
  return c.json({ ok: true, ticket: ticket.id, status: parsed.data.kind });
});

const designBody = z.object({
  markdown: z.string().min(1),
  review_html: z.string().nullable().default(null),
  created_by: z.string().default('planner'),
});
/** Designs are stored, never committed. This is where a planner run lands. */
app.post('/api/tickets/:ref/designs', async c => {
  const found = await findTicket(c.req.param('ref'));
  if (!found.ok) return c.json(found.body, found.status);
  const ticket = found.ticket;
  const parsed = designBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { markdown, review_html, created_by } = parsed.data;
  const design = await createDesign(ticket.id, markdown, review_html, created_by);
  await moveTicket(ticket.id, ticket.project_id, 'design_review');
  return c.json({ ok: true, design, ticket: ticket.id, status: 'design_review' });
});

app.get('/api/designs/:id', async c => {
  const [design] = await sql`select * from design where id = ${c.req.param('id')}`;
  return design ? c.json(design) : c.json({ error: 'not found' }, 404);
});

app.post('/api/designs/:id/approve', async c => {
  const [design] = await sql<{ id: string; ticket_id: string }[]>`
    select id, ticket_id from design where id = ${c.req.param('id')}`;
  if (!design) return c.json({ error: 'not found' }, 404);
  const ticket = await getTicket(design.ticket_id);
  if (!ticket) return c.json({ error: 'ticket gone' }, 404);
  await sql`update design set status = 'approved', approved_by = 'roze', approved_at = now()
            where id = ${design.id}`;
  await moveTicket(ticket.id, ticket.project_id, 'ready_for_dev');
  return c.json({ ok: true, design: design.id, ticket: ticket.id, status: 'ready_for_dev' });
});

const noteBody = z.object({ note: z.string().min(1), anchor: z.string().default('') });
/** An annotation on the review document. Notes accumulate; sending it back is a
    separate act, so you can read the whole thing before deciding. */
app.post('/api/designs/:id/notes', async c => {
  const parsed = noteBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const [design] = await sql<{ id: string; notes: unknown[] }[]>`
    select id, notes from design where id = ${c.req.param('id')}`;
  if (!design) return c.json({ error: 'not found' }, 404);
  const notes = [...(design.notes ?? []),
                 { at: new Date().toISOString(), note: parsed.data.note, anchor: parsed.data.anchor }];
  await sql`update design set notes = ${sql.json(notes as never)} where id = ${design.id}`;
  return c.json({ ok: true, design: design.id, notes: notes.length });
});

app.post('/api/designs/:id/reject', async c => {
  const body = await c.req.json().catch(() => ({}));
  const [design] = await sql<{ id: string; ticket_id: string; notes: unknown[] }[]>`
    select id, ticket_id, notes from design where id = ${c.req.param('id')}`;
  if (!design) return c.json({ error: 'not found' }, 404);
  const notes = body.note
    ? [...(design.notes ?? []), { at: new Date().toISOString(), note: body.note }]
    : (design.notes ?? []);
  await sql`update design set status = 'rejected', notes = ${sql.json(notes as never)}
            where id = ${design.id}`;
  const ticket = await getTicket(design.ticket_id);
  if (ticket) await moveTicket(ticket.id, ticket.project_id, 'ready_for_design');
  return c.json({ ok: true, design: design.id, status: 'ready_for_design' });
});

/** Open questions across every project — what the approvals inbox reads. */
app.get('/api/questions', async c => {
  const rows = await sql`
    select q.*, t.short_id, t.title as ticket_title, r.id as run
    from question q
    join run r on r.id = q.run_id
    join ticket t on t.id = r.ticket_id
    where q.answered_at is null
    order by q.asked_at desc, q.seq asc`;
  return c.json({ questions: rows });
});

const answerBody = z.object({ answer: z.string(), answered_by: z.string().default('roze') });
/** Answering releases the phase that is parked on this question. */
app.post('/api/questions/:id/answer', async c => {
  const parsed = answerBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const rows = await sql<{ id: string }[]>`
    update question set answer = ${parsed.data.answer},
                        answered_by = ${parsed.data.answered_by}, answered_at = now()
    where id = ${c.req.param('id')} and answered_at is null
    returning id`;
  if (!rows.length) return c.json({ error: 'not found or already answered' }, 404);
  return c.json({ ok: true, question: rows[0]!.id });
});

app.get('/api/runs/:id', async c => {
  const [run] = await sql`select * from run where id = ${c.req.param('id')}`;
  if (!run) return c.json({ error: 'not found' }, 404);
  const phases = await sql`select * from phase where run_id = ${c.req.param('id')} order by seq`;
  return c.json({ run, phases });
});

app.get('/api/runs/:id/events', async c => {
  const cursor = c.req.query('cursor') ?? '0';
  const rows = await eventsAfter(c.req.param('id'), cursor, Number(c.req.query('limit') ?? 500));
  return c.json({ events: rows, cursor: rows.at(-1)?.id ?? c.req.query('cursor') ?? '0' });
});

/** Live tail and history are the same cursor query; NOTIFY just says "look again". */
app.get('/api/runs/:id/stream', c => {
  const runId = c.req.param('id');
  return streamSSE(c, async stream => {
    let cursor = c.req.query('cursor') ?? '0';
    let pending = true;
    let awake: (() => void) | undefined;

    const off = onEvent(id => {
      if (id !== runId) return;
      pending = true;
      awake?.();
    });
    stream.onAbort(off);

    const flush = async () => {
      for (;;) {
        const rows = await eventsAfter(runId, cursor, 500);
        if (!rows.length) return;
        for (const row of rows) {
          await stream.writeSSE({ id: row.id, event: 'event', data: JSON.stringify(row) });
          cursor = row.id;
        }
        if (rows.length < 500) return;
      }
    };

    while (!stream.closed && !stream.aborted) {
      if (pending) { pending = false; await flush(); }
      await stream.writeSSE({ event: 'ping', data: cursor });
      await new Promise<void>(resolve => {
        awake = resolve;
        setTimeout(resolve, 15_000);
      });
      awake = undefined;
    }
    off();
  });
});

const port = Number(process.env.API_PORT ?? 4848);
serve({ fetch: app.fetch, port }, info => console.log(`goblin api on :${info.port}`));
