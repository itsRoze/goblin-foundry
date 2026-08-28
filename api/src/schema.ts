import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Installation-wide settings; S1 holds only `ticket_prefix`. */
export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
