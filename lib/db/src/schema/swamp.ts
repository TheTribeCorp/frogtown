import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMembersTable = pgTable("swamp_conversation_members", {
  conversationId: text("conversation_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messagesTable = pgTable("swamp_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderAddress: text("sender_address").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  encrypted: boolean("encrypted").notNull().default(true),
});

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

export const insertConversationSchema = createInsertSchema(conversationsTable);
export const insertMessageSchema = createInsertSchema(messagesTable);
export const insertGroupSchema = createInsertSchema(groupsTable);
export const insertGroupMemberSchema = createInsertSchema(groupMembersTable);
export const insertConversationMemberSchema = createInsertSchema(conversationMembersTable);

export type Conversation = z.infer<typeof insertConversationSchema>;
export type Message = z.infer<typeof insertMessageSchema>;
export type Group = z.infer<typeof insertGroupSchema>;