import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts', { userId: text('user_id').primaryKey(), data: text('data').notNull(), revision: integer('revision').notNull().default(0), secret: text('secret'), lease: text('lease'), leaseUntil: integer('lease_until').notNull().default(0) });
