import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const timelinePostsTable = pgTable("swamp_timeline_posts", {
  id: text("id").primaryKey(),
  authorAddress: text("author_address").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("swamp_timeline_posts_created_at_idx").on(table.createdAt)]);

export const timelinePostLikesTable = pgTable("swamp_timeline_post_likes", {
  postId: text("post_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.postId, table.walletAddress] }),
  index("swamp_timeline_post_likes_wallet_idx").on(table.walletAddress),
]);

export const timelinePostCommentsTable = pgTable("swamp_timeline_post_comments", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  authorAddress: text("author_address").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("swamp_timeline_post_comments_post_created_idx").on(table.postId, table.createdAt)]);

export const timelineContentReportsTable = pgTable("swamp_timeline_content_reports", {
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  category: text("category").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.subjectType, table.subjectId, table.walletAddress] }),
  index("swamp_timeline_reports_subject_idx").on(table.subjectType, table.subjectId),
  index("swamp_timeline_reports_wallet_created_idx").on(table.walletAddress, table.createdAt),
]);

export const insertTimelinePostSchema = createInsertSchema(timelinePostsTable);
export const insertTimelinePostLikeSchema = createInsertSchema(timelinePostLikesTable);
export const insertTimelinePostCommentSchema = createInsertSchema(timelinePostCommentsTable);
export const insertTimelineContentReportSchema = createInsertSchema(timelineContentReportsTable);

export type TimelinePost = z.infer<typeof insertTimelinePostSchema>;
export type TimelinePostLike = z.infer<typeof insertTimelinePostLikeSchema>;
export type TimelinePostComment = z.infer<typeof insertTimelinePostCommentSchema>;
export type TimelineContentReport = z.infer<typeof insertTimelineContentReportSchema>;
