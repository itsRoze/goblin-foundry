import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { TICKET_STATUSES } from '@goblin/shared';

/** Installation-wide settings; S1 holds only `ticket_prefix`. */
export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Timestamps are ISO-8601 strings (UTC). */
const lifecycle = {
  archived_at: text('archived_at'),
  trashed_at: text('trashed_at'),
  /** `app:3` / `project:5` when trashed by a parent's `?cascade=1`, so that parent's restore revives exactly these. */
  trashed_via: text('trashed_via'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
};

export const app = sqliteTable('app', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  repository_url: text('repository_url'),
  default_branch: text('default_branch'),
  description: text('description').notNull().default(''),
  ...lifecycle,
});

export const project = sqliteTable('project', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  app_id: integer('app_id').references(() => app.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** The Project Design, a markdown document stored with the project (ADR-0005). */
  design: text('design'),
  ...lifecycle,
});

/** The eight names as a SQL list, so the column's CHECK is built from `shared`'s one list and cannot drift from it (`ensureSchema` uses it too). */
export const statusList = () => sql.raw(TICKET_STATUSES.map((s) => `'${s}'`).join(','));

/**
 * A ticket is never archived (CONTEXT.md) — it is `cancelled` (a decision) or
 * trashed (a mistake). `status` is a checked text column, not an enum table
 * (ADR-0003); `id` is the ticket's permanent number (ADR-0002) and the key
 * `GF-<id>` is derived at the edge from the installation prefix.
 */
export const ticket = sqliteTable(
  'ticket',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('backlog').$type<(typeof TICKET_STATUSES)[number]>(),
    /** "straightforward enough to build without a Ticket Design" — the approve guard reads it (issue 04). */
    simple: integer('simple', { mode: 'boolean' }).notNull().default(false),
    /** The Ticket Design, a markdown document stored with the ticket (ADR-0005). */
    design: text('design'),
    app_id: integer('app_id').references(() => app.id),
    project_id: integer('project_id').references(() => project.id),
    trashed_at: text('trashed_at'),
    trashed_via: text('trashed_via'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [check('ticket_status', sql`${t.status} IN (${statusList()})`)],
);

/**
 * "blocker blocks blocked" — a durable fact, not a live constraint (ADR-0009).
 * The pair is the identity, so a re-declared edge is idempotent; edges survive
 * a trip through the trash, which is why nothing here cascades.
 */
export const dependency = sqliteTable(
  'dependency',
  {
    blocker_id: integer('blocker_id')
      .notNull()
      .references(() => ticket.id),
    blocked_id: integer('blocked_id')
      .notNull()
      .references(() => ticket.id),
    created_at: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.blocker_id, t.blocked_id] }), index('dependency_blocked').on(t.blocked_id)],
);

/** Saved references to implementation work; links survive ticket trash/restore. */
export const implementationLink = sqliteTable('implementation_link', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticket_id: integer('ticket_id').notNull().references(() => ticket.id),
  url: text('url').notNull(),
  created_at: text('created_at').notNull(),
}, (t) => [uniqueIndex('implementation_link_ticket_url').on(t.ticket_id, t.url)]);

/** One row per write; `prior`/`new` are JSON of only the changed fields. */
export const event = sqliteTable('event', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entity_kind: text('entity_kind').notNull(),
  entity_id: integer('entity_id').notNull(),
  actor: text('actor').notNull(),
  kind: text('kind').notNull(),
  prior: text('prior', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  new: text('new', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  at: text('at').notNull(),
});

/** A ticket as stored — what every route that judges or writes one is handed. */
export type TicketRow = typeof ticket.$inferSelect;
