import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const mobileAuthRequestsTable = pgTable("frogtown_mobile_auth_requests", {
  id: text("id").primaryKey(),
  codeChallenge: text("code_challenge").notNull(),
  clientHash: text("client_hash").notNull(),
  walletAddress: text("wallet_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("frogtown_mobile_auth_client_idx").on(table.clientHash, table.createdAt),
]);

export const nativePushDevicesTable = pgTable("frogtown_native_push_devices", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  walletAddress: text("wallet_address").notNull(),
  platform: text("platform").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("frogtown_native_push_wallet_idx").on(table.walletAddress),
]);
