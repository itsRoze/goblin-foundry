import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  ...lifecycle,
});

/**
 * Tickets proper arrive in issue 03; only the columns that App/Project moves
 * and trash touch (`app_id`, `project_id`, `trashed_*`) are here so ADR-0007
 * holds from the start. A ticket is never archived (CONTEXT.md).
 */
export const ticket = sqliteTable('ticket', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  app_id: integer('app_id').references(() => app.id),
  project_id: integer('project_id').references(() => project.id),
  trashed_at: text('trashed_at'),
  trashed_via: text('trashed_via'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

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
