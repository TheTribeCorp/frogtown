import { check, date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const hermitBuyFunnelDailyTable = pgTable("frogtown_hermit_buy_funnel_daily", {
  eventDay: date("event_day", { mode: "string" }).notNull(),
  event: text("event").notNull(),
  eventCount: integer("event_count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.eventDay, table.event] }),
  check("frogtown_hermit_buy_funnel_event_count_check", sql`${table.eventCount} >= 0`),
  check(
    "frogtown_hermit_buy_funnel_event_name_check",
    sql`${table.event} in (
      'quote_preview',
      'trustline_approval',
      'buy_approval',
      'buy_completed',
      'buy_unfilled',
      'buy_failed',
      'buy_rejected',
      'buy_expired',
      'buy_wallet_mismatch',
      'trustline_rejected',
      'trustline_expired',
      'trustline_wallet_mismatch'
    )`,
  ),
]);
