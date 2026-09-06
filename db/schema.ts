import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Only short-lived request counters; no financial inputs, questions or replies.
export const aiRequests = sqliteTable('ai_requests', {
  id: text('id').primaryKey(),
  clientKey: text('client_key').notNull(),
  createdAt: integer('created_at').notNull(),
  leaseUntil: integer('lease_until').notNull(),
}, table => [
  index('idx_ai_requests_created').on(table.createdAt),
  index('idx_ai_requests_client_created').on(table.clientKey, table.createdAt),
  index('idx_ai_requests_lease').on(table.leaseUntil),
]);
