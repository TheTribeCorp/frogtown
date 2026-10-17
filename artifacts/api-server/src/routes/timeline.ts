import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateTimelineCommentBody,
  CreateTimelineCommentParams,
  CreateTimelineCommentResponse,
  CreateTimelinePostBody,
  CreateTimelinePostResponse,
  DeleteTimelineCommentParams,
  DeleteTimelinePostParams,
  GetTimelineModerationAccessResponse,
  LikeTimelinePostParams,
  LikeTimelinePostResponse,
  ListTimelineModerationHistoryQueryParams,
  ListTimelineModerationHistoryResponse,
  ListTimelineModerationReportsResponse,
  ListTimelineCommentsParams,
  ListTimelineCommentsQueryParams,
  ListTimelineCommentsResponse,
  ListTimelinePostsQueryParams,
  ListTimelinePostsResponse,
  ReportTimelineContentBody,
  ReportTimelineContentResponse,
  ResolveTimelineModerationReportBody,
  ResolveTimelineModerationReportParams,
  ResolveTimelineModerationReportResponse,
  UpdateTimelineCommentBody,
  UpdateTimelineCommentParams,
  UpdateTimelineCommentResponse,
  UpdateTimelinePostBody,
  UpdateTimelinePostParams,
  UpdateTimelinePostResponse,
  UnlikeTimelinePostParams,
  UnlikeTimelinePostResponse,
} from "@workspace/api-zod";
import {
  db,
  timelineContentReportsTable,
  timelineModerationActionsTable,
  timelinePostCommentsTable,
  timelinePostLikesTable,
  timelinePostsTable,
  walletProfilesTable,
} from "@workspace/db";
import { recordDailyQuestActionInTransaction } from "../lib/gamification";
import { requireAuth } from "./swamp";

const router: IRouter = Router();
const DEFAULT_POST_PAGE_SIZE = 30;
const DEFAULT_COMMENT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const FEED_RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_POSTS_PER_WINDOW = 5;
const MAX_COMMENTS_PER_WINDOW = 15;
type TimelineTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TimelineCursor = { createdAt: Date; id: string };

class TimelineRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number, contentType: "post" | "comment") {
    super(contentType === "post"
      ? "You have shared several posts recently. Please wait a little before posting again."
      : "You have left several comments recently. Please wait a little before commenting again.");
  }
}

function throwTimelineRateLimit(oldestCreatedAt: string | null, contentType: "post" | "comment"): never {
  const oldestTimestamp = oldestCreatedAt ? Date.parse(oldestCreatedAt) : Number.NaN;
  const retryAt = (Number.isFinite(oldestTimestamp) ? oldestTimestamp : Date.now()) + FEED_RATE_WINDOW_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  throw new TimelineRateLimitError(retryAfterSeconds, contentType);
}

async function lockTimelineRateLimit(
  tx: TimelineTransaction,
  walletAddress: string,
  contentType: "post" | "comment",
) {
  const lockScope = `timeline-${contentType}`;
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext(${walletAddress}), hashtext(${lockScope}))
  `);
}

async function enforcePostRateLimit(tx: TimelineTransaction, walletAddress: string) {
  await lockTimelineRateLimit(tx, walletAddress, "post");
  const cutoff = new Date(Date.now() - FEED_RATE_WINDOW_MS);
  const [activity] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      oldestCreatedAt: sql<string | null>`min(${timelinePostsTable.createdAt})::text`,
    })
    .from(timelinePostsTable)
    .where(and(
      eq(timelinePostsTable.authorAddress, walletAddress),
      gt(timelinePostsTable.createdAt, cutoff),
    ));
  if (Number(activity?.count ?? 0) >= MAX_POSTS_PER_WINDOW) {
    throwTimelineRateLimit(activity?.oldestCreatedAt ?? null, "post");
  }
}

async function enforceCommentRateLimit(tx: TimelineTransaction, walletAddress: string) {
  await lockTimelineRateLimit(tx, walletAddress, "comment");
  const cutoff = new Date(Date.now() - FEED_RATE_WINDOW_MS);
  const [activity] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      oldestCreatedAt: sql<string | null>`min(${timelinePostCommentsTable.createdAt})::text`,
    })
    .from(timelinePostCommentsTable)
    .where(and(
      eq(timelinePostCommentsTable.authorAddress, walletAddress),
      gt(timelinePostCommentsTable.createdAt, cutoff),
    ));
  if (Number(activity?.count ?? 0) >= MAX_COMMENTS_PER_WINDOW) {
    throwTimelineRateLimit(activity?.oldestCreatedAt ?? null, "comment");
  }
}

function encodeCursor(value: TimelineCursor) {
  return Buffer.from(JSON.stringify({
    createdAt: value.createdAt.toISOString(),
    id: value.id,
  })).toString("base64url");
}

function decodeCursor(value: string | undefined): { cursor: TimelineCursor | null; valid: boolean } {
  if (!value) return { cursor: null, valid: true };
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string" || !decoded.id
      || decoded.id.length > 120) return { cursor: null, valid: false };
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) return { cursor: null, valid: false };
    return { cursor: { createdAt, id: decoded.id }, valid: true };
  } catch {
    return { cursor: null, valid: false };
  }
}

async function postExists(postId: string) {
  const rows = await db
    .select({ id: timelinePostsTable.id })
    .from(timelinePostsTable)
    .where(eq(timelinePostsTable.id, postId))
    .limit(1);
  return Boolean(rows[0]);
}

async function serializePosts(rows: (typeof timelinePostsTable.$inferSelect)[], walletAddress: string) {
  if (rows.length === 0) return [];
  const postIds = rows.map((row) => row.id);
  const authorAddresses = [...new Set(rows.map((row) => row.authorAddress))];
  const [likeCounts, commentCounts, ownLikes, ownReports, profiles] = await Promise.all([
    db
      .select({ postId: timelinePostLikesTable.postId, value: sql<number>`count(*)::int` })
      .from(timelinePostLikesTable)
      .where(inArray(timelinePostLikesTable.postId, postIds))
      .groupBy(timelinePostLikesTable.postId),
    db
      .select({ postId: timelinePostCommentsTable.postId, value: sql<number>`count(*)::int` })
      .from(timelinePostCommentsTable)
      .where(inArray(timelinePostCommentsTable.postId, postIds))
      .groupBy(timelinePostCommentsTable.postId),
    db
      .select({ postId: timelinePostLikesTable.postId })
      .from(timelinePostLikesTable)
      .where(and(
        inArray(timelinePostLikesTable.postId, postIds),
        eq(timelinePostLikesTable.walletAddress, walletAddress),
      )),
    db
      .select({ subjectId: timelineContentReportsTable.subjectId })
      .from(timelineContentReportsTable)
      .where(and(
        eq(timelineContentReportsTable.subjectType, "post"),
        inArray(timelineContentReportsTable.subjectId, postIds),
        eq(timelineContentReportsTable.walletAddress, walletAddress),
      )),
    db
      .select({
        walletAddress: walletProfilesTable.walletAddress,
        username: walletProfilesTable.username,
      })
      .from(walletProfilesTable)
      .where(inArray(walletProfilesTable.walletAddress, authorAddresses)),
  ]);
  const likesByPost = new Map(likeCounts.map((row) => [row.postId, row.value]));
  const commentsByPost = new Map(commentCounts.map((row) => [row.postId, row.value]));
  const likedPostIds = new Set(ownLikes.map((row) => row.postId));
  const reportedPostIds = new Set(ownReports.map((row) => row.subjectId));
  const usernamesByWallet = new Map(profiles.map((profile) => [profile.walletAddress, profile.username]));
  return rows.map((row) => ({
    ...row,
    authorUsername: usernamesByWallet.get(row.authorAddress) ?? null,
    likeCount: likesByPost.get(row.id) ?? 0,
    commentCount: commentsByPost.get(row.id) ?? 0,
    likedByMe: likedPostIds.has(row.id),
    reportedByMe: reportedPostIds.has(row.id),
  }));
}

async function serializeComments(
  rows: (typeof timelinePostCommentsTable.$inferSelect)[],
  walletAddress: string,
) {
  if (rows.length === 0) return [];
  const [ownReports, profiles] = await Promise.all([
    db
      .select({ subjectId: timelineContentReportsTable.subjectId })
      .from(timelineContentReportsTable)
      .where(and(
        eq(timelineContentReportsTable.subjectType, "comment"),
        inArray(timelineContentReportsTable.subjectId, rows.map((row) => row.id)),
        eq(timelineContentReportsTable.walletAddress, walletAddress),
      )),
    db
      .select({
        walletAddress: walletProfilesTable.walletAddress,
        username: walletProfilesTable.username,
      })
      .from(walletProfilesTable)
      .where(inArray(walletProfilesTable.walletAddress, [...new Set(rows.map((row) => row.authorAddress))])),
  ]);
  const reportedCommentIds = new Set(ownReports.map((row) => row.subjectId));
  const usernamesByWallet = new Map(profiles.map((profile) => [profile.walletAddress, profile.username]));
  return rows.map((row) => ({
    ...row,
    authorUsername: usernamesByWallet.get(row.authorAddress) ?? null,
    reportedByMe: reportedCommentIds.has(row.id),
  }));
}

async function serializeReaction(postId: string, walletAddress: string) {
  const [countRows, ownLike] = await Promise.all([
    db
      .select({ likeCount: count() })
      .from(timelinePostLikesTable)
      .where(eq(timelinePostLikesTable.postId, postId)),
    db
      .select({ postId: timelinePostLikesTable.postId })
      .from(timelinePostLikesTable)
      .where(and(
        eq(timelinePostLikesTable.postId, postId),
        eq(timelinePostLikesTable.walletAddress, walletAddress),
      ))
      .limit(1),
  ]);
  return {
    postId,
    likeCount: countRows[0]?.likeCount ?? 0,
    likedByMe: Boolean(ownLike[0]),
  };
}

function invalidBody(res: Response, message: string) {
  res.status(400).json({ error: message });
}

function configuredModeratorWallets() {
  return new Set(
    (process.env.FROGTOWN_MODERATOR_WALLETS ?? "")
      .split(",")
      .map((wallet) => wallet.trim())
      .filter(Boolean),
  );
}

function requireModerator(walletAddress: string, res: Response) {
  const moderators = configuredModeratorWallets();
  if (moderators.size === 0) {
    res.status(503).json({ error: "Moderator access is not configured." });
    return false;
  }
  if (!moderators.has(walletAddress)) {
    res.status(403).json({ error: "Only configured Frogtown moderators can review reports." });
    return false;
  }
  return true;
}

async function removeTimelineCommentInTransaction(transaction: TimelineTransaction, commentId: string) {
  await transaction
    .delete(timelineContentReportsTable)
    .where(and(
      eq(timelineContentReportsTable.subjectType, "comment"),
      eq(timelineContentReportsTable.subjectId, commentId),
    ));
  await transaction
    .delete(timelinePostCommentsTable)
    .where(eq(timelinePostCommentsTable.id, commentId));
}

async function removeTimelineComment(commentId: string) {
  await db.transaction((transaction) => removeTimelineCommentInTransaction(transaction, commentId));
}

async function removeTimelinePostInTransaction(transaction: TimelineTransaction, postId: string) {
  const comments = await transaction
    .select({ id: timelinePostCommentsTable.id })
    .from(timelinePostCommentsTable)
    .where(eq(timelinePostCommentsTable.postId, postId));
  if (comments.length > 0) {
    await transaction
      .delete(timelineContentReportsTable)
      .where(and(
        eq(timelineContentReportsTable.subjectType, "comment"),
        inArray(timelineContentReportsTable.subjectId, comments.map((comment) => comment.id)),
      ));
    await transaction
      .delete(timelinePostCommentsTable)
      .where(eq(timelinePostCommentsTable.postId, postId));
  }
  await transaction
    .delete(timelineContentReportsTable)
    .where(and(
      eq(timelineContentReportsTable.subjectType, "post"),
      eq(timelineContentReportsTable.subjectId, postId),
    ));
  await transaction
    .delete(timelinePostLikesTable)
    .where(eq(timelinePostLikesTable.postId, postId));
  await transaction
    .delete(timelinePostsTable)
    .where(eq(timelinePostsTable.id, postId));
}

async function removeTimelinePost(postId: string) {
  await db.transaction((transaction) => removeTimelinePostInTransaction(transaction, postId));
}

router.get("/timeline/posts", async (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const query = ListTimelinePostsQueryParams.safeParse(req.query);
  if (!query.success) {
    invalidBody(res, "Timeline page size or cursor is invalid.");
    return;
  }
  const { cursor, valid } = decodeCursor(query.data.cursor);
  if (!valid) {
    invalidBody(res, "Timeline cursor is invalid.");
    return;
  }
  try {
    const createdAtBucket = sql<Date>`date_trunc('milliseconds', ${timelinePostsTable.createdAt})`;
    const rows = await db
      .select()
      .from(timelinePostsTable)
      .where(cursor
        ? or(
          lt(createdAtBucket, cursor.createdAt),
          and(eq(createdAtBucket, cursor.createdAt), lt(timelinePostsTable.id, cursor.id)),
        )
        : undefined)
      .orderBy(desc(createdAtBucket), desc(timelinePostsTable.id))
      .limit(Math.min(query.data.limit ?? DEFAULT_POST_PAGE_SIZE, MAX_PAGE_SIZE) + 1);
    const hasMore = rows.length > Math.min(query.data.limit ?? DEFAULT_POST_PAGE_SIZE, MAX_PAGE_SIZE);
    const pageRows = rows.slice(0, Math.min(query.data.limit ?? DEFAULT_POST_PAGE_SIZE, MAX_PAGE_SIZE));
    const items = await serializePosts(pageRows, walletAddress);
    const last = pageRows[pageRows.length - 1];
    res.json(ListTimelinePostsResponse.parse({
      items,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    }));
  } catch {
    res.status(500).json({ error: "Unable to load the timeline." });
  }
});

router.post("/timeline/posts", async (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsed = CreateTimelinePostBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.body.trim()) {
    invalidBody(res, "Posts must contain between 1 and 5000 non-space characters.");
    return;
  }
  try {
    const inserted = await db.transaction(async (tx) => {
      await enforcePostRateLimit(tx, walletAddress);
      const [post] = await tx
        .insert(timelinePostsTable)
        .values({
          id: `post-${randomUUID()}`,
          authorAddress: walletAddress,
          body: parsed.data.body.trim(),
        })
        .returning();
      await recordDailyQuestActionInTransaction(tx, walletAddress, "timeline_post", post.id);
      return post;
    });
    const post = (await serializePosts([inserted], walletAddress))[0];
    res.status(201).json(CreateTimelinePostResponse.parse(post));
  } catch (error) {
    if (error instanceof TimelineRateLimitError) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
      res.status(429).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Unable to publish this post." });
  }
});

router.patch("/timeline/posts/:postId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const params = UpdateTimelinePostParams.safeParse(req.params);
  const body = UpdateTimelinePostBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.body.trim()) {
    invalidBody(res, "A valid post and non-empty body are required.");
    return;
  }
  try {
    const existing = await db
      .select()
      .from(timelinePostsTable)
      .where(eq(timelinePostsTable.id, params.data.postId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (existing[0].authorAddress !== walletAddress) {
      res.status(403).json({ error: "You can only edit your own posts." });
      return;
    }
    const updated = await db
      .update(timelinePostsTable)
      .set({ body: body.data.body.trim() })
      .where(eq(timelinePostsTable.id, params.data.postId))
      .returning();
    res.json(UpdateTimelinePostResponse.parse((await serializePosts(updated, walletAddress))[0]));
  } catch {
    res.status(500).json({ error: "Unable to update this post." });
  }
});

router.delete("/timeline/posts/:postId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const params = DeleteTimelinePostParams.safeParse(req.params);
  if (!params.success) {
    invalidBody(res, "A valid post ID is required.");
    return;
  }
  try {
    const existing = await db
      .select({ authorAddress: timelinePostsTable.authorAddress })
      .from(timelinePostsTable)
      .where(eq(timelinePostsTable.id, params.data.postId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (existing[0].authorAddress !== walletAddress) {
      res.status(403).json({ error: "You can only remove your own posts." });
      return;
    }
    await removeTimelinePost(params.data.postId);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Unable to remove this post." });
  }
});

async function handleLike(req: Request, res: Response, shouldLike: boolean) {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const ParamsSchema = shouldLike ? LikeTimelinePostParams : UnlikeTimelinePostParams;
  const parsed = ParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    invalidBody(res, "A valid post ID is required.");
    return;
  }
  const postId = parsed.data.postId;
  try {
    const exists = await db.transaction(async (tx) => {
      const [post] = await tx
        .select({ authorAddress: timelinePostsTable.authorAddress })
        .from(timelinePostsTable)
        .where(eq(timelinePostsTable.id, postId))
        .limit(1);
      if (!post) return false;
      if (shouldLike) {
        const inserted = await tx
          .insert(timelinePostLikesTable)
          .values({ postId, walletAddress })
          .onConflictDoNothing()
          .returning({ postId: timelinePostLikesTable.postId });
        if (inserted.length > 0 && post.authorAddress !== walletAddress) {
          await recordDailyQuestActionInTransaction(tx, walletAddress, "other_post_like", postId);
        }
      } else {
        await tx
          .delete(timelinePostLikesTable)
          .where(and(
            eq(timelinePostLikesTable.postId, postId),
            eq(timelinePostLikesTable.walletAddress, walletAddress),
          ));
      }
      return true;
    });
    if (!exists) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    const reaction = shouldLike
      ? LikeTimelinePostResponse.parse(await serializeReaction(postId, walletAddress))
      : UnlikeTimelinePostResponse.parse(await serializeReaction(postId, walletAddress));
    res.json(reaction);
  } catch {
    res.status(500).json({ error: "Unable to update this like." });
  }
}

router.post("/timeline/posts/:postId/likes", (req, res) => {
  void handleLike(req, res, true);
});

router.delete("/timeline/posts/:postId/likes", (req, res) => {
  void handleLike(req, res, false);
});

router.get("/timeline/posts/:postId/comments", async (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsed = ListTimelineCommentsParams.safeParse(req.params);
  if (!parsed.success) {
    invalidBody(res, "A valid post ID is required.");
    return;
  }
  const query = ListTimelineCommentsQueryParams.safeParse(req.query);
  if (!query.success) {
    invalidBody(res, "Reply page size or cursor is invalid.");
    return;
  }
  const { cursor, valid } = decodeCursor(query.data.cursor);
  if (!valid) {
    invalidBody(res, "Reply cursor is invalid.");
    return;
  }
  try {
    if (!(await postExists(parsed.data.postId))) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    const createdAtBucket = sql<Date>`date_trunc('milliseconds', ${timelinePostCommentsTable.createdAt})`;
    const limit = Math.min(query.data.limit ?? DEFAULT_COMMENT_PAGE_SIZE, MAX_PAGE_SIZE);
    const comments = await db
      .select()
      .from(timelinePostCommentsTable)
      .where(and(
        eq(timelinePostCommentsTable.postId, parsed.data.postId),
        cursor
          ? or(
            lt(createdAtBucket, cursor.createdAt),
            and(eq(createdAtBucket, cursor.createdAt), lt(timelinePostCommentsTable.id, cursor.id)),
          )
          : undefined,
      ))
      .orderBy(desc(createdAtBucket), desc(timelinePostCommentsTable.id))
      .limit(limit + 1);
    const hasMore = comments.length > limit;
    const pageRows = comments.slice(0, limit);
    const items = await serializeComments(pageRows, walletAddress);
    const last = pageRows[pageRows.length - 1];
    res.json(ListTimelineCommentsResponse.parse({
      items,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    }));
  } catch {
    res.status(500).json({ error: "Unable to load comments." });
  }
});

router.post("/timeline/reports", async (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsed = ReportTimelineContentBody.safeParse(req.body);
  if (!parsed.success) {
    invalidBody(res, "Select a report reason and a valid post or comment.");
    return;
  }
  const { subjectType, subjectId, category, details } = parsed.data;
  try {
    const exists = subjectType === "post"
      ? await postExists(subjectId)
      : Boolean((await db
        .select({ id: timelinePostCommentsTable.id })
        .from(timelinePostCommentsTable)
        .where(eq(timelinePostCommentsTable.id, subjectId))
        .limit(1))[0]);
    if (!exists) {
      res.status(404).json({ error: "Reported content was not found." });
      return;
    }
    await db
      .insert(timelineContentReportsTable)
      .values({
        subjectType,
        subjectId,
        walletAddress,
        category,
        details: details?.trim() || null,
      })
      .onConflictDoNothing();
    res.status(201).json(ReportTimelineContentResponse.parse({
      subjectType,
      subjectId,
      reported: true,
    }));
  } catch {
    res.status(500).json({ error: "Unable to record this report." });
  }
});

router.get("/timeline/moderation/access", (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  res.json(GetTimelineModerationAccessResponse.parse({
    isModerator: configuredModeratorWallets().has(walletAddress),
  }));
});

router.get("/timeline/moderation/reports", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress || !requireModerator(walletAddress, res)) return;
  try {
    const reports = await db
      .select()
      .from(timelineContentReportsTable)
      .orderBy(desc(timelineContentReportsTable.createdAt))
      .limit(1000);
    const grouped = new Map<string, {
      subjectType: "post" | "comment";
      subjectId: string;
      reports: typeof reports;
    }>();
    for (const report of reports) {
      if (report.subjectType !== "post" && report.subjectType !== "comment") continue;
      const key = `${report.subjectType}:${report.subjectId}`;
      const group = grouped.get(key) ?? {
        subjectType: report.subjectType,
        subjectId: report.subjectId,
        reports: [],
      };
      group.reports.push(report);
      grouped.set(key, group);
    }
    const postIds = [...grouped.values()]
      .filter((group) => group.subjectType === "post")
      .map((group) => group.subjectId);
    const commentIds = [...grouped.values()]
      .filter((group) => group.subjectType === "comment")
      .map((group) => group.subjectId);
    const [posts, comments] = await Promise.all([
      postIds.length > 0
        ? db.select().from(timelinePostsTable).where(inArray(timelinePostsTable.id, postIds))
        : Promise.resolve([]),
      commentIds.length > 0
        ? db.select().from(timelinePostCommentsTable).where(inArray(timelinePostCommentsTable.id, commentIds))
        : Promise.resolve([]),
    ]);
    const contentById = new Map<string, { body: string; authorAddress: string }>();
    for (const post of posts) contentById.set(`post:${post.id}`, post);
    for (const comment of comments) contentById.set(`comment:${comment.id}`, comment);
    const items = [...grouped.values()].flatMap((group) => {
      const content = contentById.get(`${group.subjectType}:${group.subjectId}`);
      if (!content) return [];
      return [{
        ...group,
        ...content,
        reports: group.reports.map((report) => ({
          walletAddress: report.walletAddress,
          category: report.category,
          details: report.details,
          createdAt: report.createdAt,
        })),
      }];
    });
    res.json(ListTimelineModerationReportsResponse.parse({ items }));
  } catch {
    res.status(500).json({ error: "Unable to load community reports." });
  }
});

router.get("/timeline/moderation/history", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress || !requireModerator(walletAddress, res)) return;
  const query = ListTimelineModerationHistoryQueryParams.safeParse(req.query);
  if (!query.success) {
    invalidBody(res, "Moderation history page size or cursor is invalid.");
    return;
  }
  const { cursor, valid } = decodeCursor(query.data.cursor);
  if (!valid) {
    invalidBody(res, "Moderation history cursor is invalid.");
    return;
  }
  try {
    const pageSize = Math.min(query.data.limit ?? 20, MAX_PAGE_SIZE);
    const createdAtBucket = sql<Date>`date_trunc('milliseconds', ${timelineModerationActionsTable.createdAt})`;
    const rows = await db
      .select()
      .from(timelineModerationActionsTable)
      .where(cursor
        ? or(
          lt(createdAtBucket, cursor.createdAt),
          and(eq(createdAtBucket, cursor.createdAt), lt(timelineModerationActionsTable.id, cursor.id)),
        )
        : undefined)
      .orderBy(desc(createdAtBucket), desc(timelineModerationActionsTable.id))
      .limit(pageSize + 1);
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    const last = items[items.length - 1];
    res.json(ListTimelineModerationHistoryResponse.parse({
      items,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    }));
  } catch {
    res.status(500).json({ error: "Unable to load moderator history." });
  }
});

router.post("/timeline/moderation/reports/:subjectType/:subjectId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress || !requireModerator(walletAddress, res)) return;
  const params = ResolveTimelineModerationReportParams.safeParse(req.params);
  const body = ResolveTimelineModerationReportBody.safeParse(req.body);
  if (!params.success || !body.success) {
    invalidBody(res, "Choose a valid report subject and moderation action.");
    return;
  }
  const { subjectType, subjectId } = params.data;
  try {
    const resolution = await db.transaction(async (tx) => {
      const openReports = await tx
        .select({ walletAddress: timelineContentReportsTable.walletAddress })
        .from(timelineContentReportsTable)
        .where(and(
          eq(timelineContentReportsTable.subjectType, subjectType),
          eq(timelineContentReportsTable.subjectId, subjectId),
        ))
        .for("update");
      if (openReports.length === 0) return "no-reports" as const;

      let content: { body: string } | undefined;
      if (subjectType === "post") {
        const [post] = await tx
          .select({ body: timelinePostsTable.body })
          .from(timelinePostsTable)
          .where(eq(timelinePostsTable.id, subjectId))
          .for("update");
        content = post;
      } else {
        const [comment] = await tx
          .select({ body: timelinePostCommentsTable.body })
          .from(timelinePostCommentsTable)
          .where(eq(timelinePostCommentsTable.id, subjectId))
          .for("update");
        content = comment;
      }
      if (!content) return "missing-content" as const;

      await tx.insert(timelineModerationActionsTable).values({
        id: `moderation-${randomUUID()}`,
        moderatorAddress: walletAddress,
        subjectType,
        subjectId,
        action: body.data.action,
        contentSnapshot: content.body,
        reportCount: openReports.length,
      });

      if (body.data.action === "dismiss") {
        await tx
          .delete(timelineContentReportsTable)
          .where(and(
            eq(timelineContentReportsTable.subjectType, subjectType),
            eq(timelineContentReportsTable.subjectId, subjectId),
          ));
      } else if (subjectType === "post") {
        await removeTimelinePostInTransaction(tx, subjectId);
      } else {
        await removeTimelineCommentInTransaction(tx, subjectId);
      }
      return "resolved" as const;
    });
    if (resolution === "no-reports") {
      res.status(404).json({ error: "No open reports were found for this item." });
      return;
    }
    if (resolution === "missing-content") {
      res.status(404).json({ error: "Reported content was not found." });
      return;
    }
    req.log.info({ subjectType, subjectId, action: body.data.action }, "Timeline report resolved");
    res.json(ResolveTimelineModerationReportResponse.parse({
      subjectType,
      subjectId,
      action: body.data.action,
      resolved: true,
    }));
  } catch {
    res.status(500).json({ error: "Unable to resolve this report." });
  }
});

router.post("/timeline/posts/:postId/comments", async (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const path = CreateTimelineCommentParams.safeParse(req.params);
  const body = CreateTimelineCommentBody.safeParse(req.body);
  if (!path.success) {
    invalidBody(res, "A valid post ID is required.");
    return;
  }
  if (!body.success || !body.data.body.trim()) {
    invalidBody(res, "Comments must contain between 1 and 2000 non-space characters.");
    return;
  }
  try {
    const comment = await db.transaction(async (tx) => {
      await enforceCommentRateLimit(tx, walletAddress);
      const [post] = await tx
        .select({ authorAddress: timelinePostsTable.authorAddress })
        .from(timelinePostsTable)
        .where(eq(timelinePostsTable.id, path.data.postId))
        .limit(1);
      if (!post) return null;
      const [created] = await tx
        .insert(timelinePostCommentsTable)
        .values({
          id: `comment-${randomUUID()}`,
          postId: path.data.postId,
          authorAddress: walletAddress,
          body: body.data.body.trim(),
        })
        .returning();
      if (post.authorAddress !== walletAddress) {
        await recordDailyQuestActionInTransaction(tx, walletAddress, "other_post_comment", created.id);
      }
      return created;
    });
    if (!comment) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    const serializedComment = (await serializeComments([comment], walletAddress))[0];
    res.status(201).json(CreateTimelineCommentResponse.parse(serializedComment));
  } catch (error) {
    if (error instanceof TimelineRateLimitError) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
      res.status(429).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Unable to publish this comment." });
  }
});

router.patch("/timeline/posts/:postId/comments/:commentId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const params = UpdateTimelineCommentParams.safeParse(req.params);
  const body = UpdateTimelineCommentBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.body.trim()) {
    invalidBody(res, "A valid comment and non-empty body are required.");
    return;
  }
  try {
    const existing = await db
      .select()
      .from(timelinePostCommentsTable)
      .where(and(
        eq(timelinePostCommentsTable.id, params.data.commentId),
        eq(timelinePostCommentsTable.postId, params.data.postId),
      ))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Comment not found." });
      return;
    }
    if (existing[0].authorAddress !== walletAddress) {
      res.status(403).json({ error: "You can only edit your own comments." });
      return;
    }
    const updated = await db
      .update(timelinePostCommentsTable)
      .set({ body: body.data.body.trim() })
      .where(eq(timelinePostCommentsTable.id, params.data.commentId))
      .returning();
    const serializedComment = (await serializeComments(updated, walletAddress))[0];
    res.json(UpdateTimelineCommentResponse.parse(serializedComment));
  } catch {
    res.status(500).json({ error: "Unable to update this comment." });
  }
});

router.delete("/timeline/posts/:postId/comments/:commentId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const params = DeleteTimelineCommentParams.safeParse(req.params);
  if (!params.success) {
    invalidBody(res, "A valid comment ID is required.");
    return;
  }
  try {
    const existing = await db
      .select()
      .from(timelinePostCommentsTable)
      .where(and(
        eq(timelinePostCommentsTable.id, params.data.commentId),
        eq(timelinePostCommentsTable.postId, params.data.postId),
      ))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Comment not found." });
      return;
    }
    if (existing[0].authorAddress !== walletAddress) {
      res.status(403).json({ error: "You can only remove your own comments." });
      return;
    }
    await removeTimelineComment(params.data.commentId);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Unable to remove this comment." });
  }
});

export default router;
