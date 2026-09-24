import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { AddImplementationLinkBodySchema } from '@goblin/shared';
import type { ActorEnv } from './actor';
import { AtomicWriteError, atomically, type Db } from './db';
import { eventWrite, now } from './events';
import { parseBody } from './http';
import { conflict, notFound } from './problems';
import { implementationLink as link, ticket, type TicketRow } from './schema';

/** One ticket's saved references. No provider requests or lifecycle transitions. */
export function implementationLinkRoutes(r: Hono<ActorEnv>, deps: {
  db: Db;
  find: (c: Context) => Promise<TicketRow | undefined>;
  missing: (c: Context) => Response;
}) {
  const { db, find, missing } = deps;
  const fields = { id: link.id, url: link.url, created_at: link.created_at };
  const touch = (id: number, at: string) => ({
    what: 'ticket is still available',
    statement: db.update(ticket).set({ updated_at: at }).where(and(eq(ticket.id, id), isNull(ticket.trashed_at))).returning({ id: ticket.id }),
  });

  r.get('/:key/implementation-links', async (c) => {
    const row = await find(c);
    if (!row) return missing(c);
    return c.json(await db.select(fields).from(link).where(eq(link.ticket_id, row.id)).orderBy(asc(link.id)));
  });

  r.post('/:key/implementation-links', async (c) => {
    const row = await find(c);
    if (!row) return missing(c);
    const body = await parseBody(c, AddImplementationLinkBodySchema);
    if (!body.ok) return body.response;
    const { url } = body.data;
    const existing = async () => (await db.select(fields).from(link).where(and(eq(link.ticket_id, row.id), eq(link.url, url))))[0];
    const prior = await existing();
    if (prior) return c.json(prior);
    const at = now();
    try {
      await atomically(db, [
        touch(row.id, at),
        { what: 'implementation link', statement: db.insert(link).values({ ticket_id: row.id, url, created_at: at }).onConflictDoNothing().returning({ id: link.id }) },
        await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'implementation_link_added', prior: null, new: { url }, at }),
      ]);
    } catch (error) {
      if (!(error instanceof AtomicWriteError)) throw error;
      if (error.kind === 'stale') {
        const duplicate = await existing();
        if (duplicate) return c.json(duplicate);
        return conflict(c, 'the ticket changed; refresh and try again');
      }
      throw error;
    }
    return c.json((await existing())!, 201);
  });

  r.delete('/:key/implementation-links/:linkId', async (c) => {
    const row = await find(c);
    if (!row) return missing(c);
    const id = Number(c.req.param('linkId'));
    if (!Number.isSafeInteger(id) || id <= 0) return notFound(c, 'implementation link not found');
    const where = and(eq(link.id, id), eq(link.ticket_id, row.id));
    const [prior] = await db.select(fields).from(link).where(where);
    if (!prior) return notFound(c, 'implementation link not found');
    const at = now();
    try {
      await atomically(db, [
        touch(row.id, at),
        { what: 'implementation link', statement: db.delete(link).where(where).returning({ id: link.id }) },
        await eventWrite(db, { entity_kind: 'ticket', entity_id: row.id, actor: c.get('actor'), kind: 'implementation_link_removed', prior: { url: prior.url }, new: { url: null }, at }),
      ]);
    } catch (error) {
      if (error instanceof AtomicWriteError && error.kind === 'stale') return conflict(c, 'the ticket or link changed; refresh and try again');
      throw error;
    }
    return c.body(null, 204);
  });
}
