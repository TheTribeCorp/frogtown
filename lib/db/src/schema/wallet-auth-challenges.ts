import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const walletAuthChallengesTable = pgTable("swamp_wallet_auth_challenges", {
  nonceHash: text("nonce_hash").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  origin: text("origin").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("swamp_wallet_auth_challenges_expires_idx").on(table.expiresAt),
]);
