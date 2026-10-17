import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const walletProfilesTable = pgTable("swamp_wallet_profiles", {
  walletAddress: text("wallet_address").primaryKey(),
  username: text("username").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("swamp_wallet_profiles_username_unique").on(table.username),
]);

export const insertWalletProfileSchema = createInsertSchema(walletProfilesTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertWalletProfile = z.infer<typeof insertWalletProfileSchema>;
export type WalletProfile = typeof walletProfilesTable.$inferSelect;
