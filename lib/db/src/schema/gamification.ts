import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const gamificationProfilesTable = pgTable("frogtown_gamification_profiles", {
  walletAddress: text("wallet_address").primaryKey(),
  pointsHundredths: integer("points_hundredths").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastCheckInDay: text("last_check_in_day"),
  frogBadgeEarnedAt: timestamp("frog_badge_earned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("frogtown_gamification_leaderboard_idx").on(table.pointsHundredths),
]);

export const dailyQuestActionsTable = pgTable("frogtown_daily_quest_actions", {
  walletAddress: text("wallet_address").notNull(),
  dayKey: text("day_key").notNull(),
  actionType: text("action_type").notNull(),
  referenceId: text("reference_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.walletAddress, table.dayKey, table.actionType] }),
  index("frogtown_daily_quest_actions_wallet_day_idx").on(table.walletAddress, table.dayKey),
]);

export const dailyQuestCompletionsTable = pgTable("frogtown_daily_quest_completions", {
  walletAddress: text("wallet_address").notNull(),
  dayKey: text("day_key").notNull(),
  questId: text("quest_id").notNull(),
  pointsHundredths: integer("points_hundredths").notNull().default(100),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.walletAddress, table.dayKey, table.questId] }),
  index("frogtown_daily_quest_completions_wallet_day_idx").on(table.walletAddress, table.dayKey),
]);

export const coinFlipsTable = pgTable("frogtown_coin_flips", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  requestId: text("request_id").notNull(),
  choice: text("choice").notNull(),
  result: text("result").notNull(),
  won: boolean("won").notNull(),
  stakeHundredths: integer("stake_hundredths").notNull(),
  payoutHundredths: integer("payout_hundredths").notNull(),
  netChangeHundredths: integer("net_change_hundredths").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("frogtown_coin_flips_wallet_request_idx").on(table.walletAddress, table.requestId),
  index("frogtown_coin_flips_wallet_created_idx").on(table.walletAddress, table.createdAt),
]);
