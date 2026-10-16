import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, primaryKey, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const conversationsTable = pgTable("swamp_conversations", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  participantLabel: text("participant_label").notNull(),
  lastMessage: text("last_message"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  unreadCount: integer("unread_count").notNull().default(0),
  encrypted: boolean("encrypted").notNull().default(true),
  memberCount: integer("member_count").notNull().default(2),
  directStatus: text("direct_status").notNull().default("accepted"),
  requesterAddress: text("requester_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMembersTable = pgTable("swamp_conversation_members", {
  conversationId: text("conversation_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
}, (table) => [
  index("swamp_conversation_members_wallet_conversation_read_idx")
    .on(table.walletAddress, table.conversationId, table.lastReadAt),
  index("swamp_conversation_members_conversation_wallet_read_idx")
    .on(table.conversationId, table.walletAddress, table.lastReadAt),
]);

export const messagesTable = pgTable("swamp_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderAddress: text("sender_address").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  encrypted: boolean("encrypted").notNull().default(true),
}, (table) => [
  index("swamp_messages_conversation_sent_idx").on(table.conversationId, table.sentAt),
]);

export const messageHistorySharesTable = pgTable("swamp_message_history_shares", {
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  sharedByAddress: text("shared_by_address").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: "swamp_message_history_shares_pk",
    columns: [table.conversationId, table.messageId, table.recipientAddress],
  }),
  index("swamp_message_history_shares_recipient_idx")
    .on(table.conversationId, table.recipientAddress),
]);

export const groupsTable = pgTable("swamp_groups", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  memberCount: integer("member_count").notNull().default(1),
  onlineCount: integer("online_count").notNull().default(0),
  creatorAddress: text("creator_address").notNull(),
});

export const groupMembersTable = pgTable("swamp_group_members", {
  groupId: text("group_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletKeysTable = pgTable("swamp_wallet_keys", {
  walletAddress: text("wallet_address").primaryKey(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blockedWalletsTable = pgTable("swamp_blocked_wallets", {
  walletAddress: text("wallet_address").notNull(),
  blockedWalletAddress: text("blocked_wallet_address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: "swamp_blocked_wallets_pk",
    columns: [table.walletAddress, table.blockedWalletAddress],
  }),
  index("swamp_blocked_wallets_blocked_idx").on(table.blockedWalletAddress),
]);

export const insertConversationSchema = createInsertSchema(conversationsTable);
export const insertMessageSchema = createInsertSchema(messagesTable);
export const insertGroupSchema = createInsertSchema(groupsTable);
export const insertGroupMemberSchema = createInsertSchema(groupMembersTable);
export const insertConversationMemberSchema = createInsertSchema(conversationMembersTable);
export const insertWalletKeySchema = createInsertSchema(walletKeysTable);
export const insertBlockedWalletSchema = createInsertSchema(blockedWalletsTable);

export type Conversation = z.infer<typeof insertConversationSchema>;
export type Message = z.infer<typeof insertMessageSchema>;
export type Group = z.infer<typeof insertGroupSchema>;
export type WalletKey = z.infer<typeof insertWalletKeySchema>;
export type BlockedWallet = z.infer<typeof insertBlockedWalletSchema>;