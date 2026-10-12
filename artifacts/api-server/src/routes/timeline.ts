import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateTimelineCommentBody,
  CreateTimelineCommentParams,
  CreateTimelineCommentResponse,
  CreateTimelinePostBody,
  CreateTimelinePostResponse,
  LikeTimelinePostParams,
  LikeTimelinePostResponse,
  ListTimelineCommentsParams,
  ListTimelineCommentsQueryParams,
  ListTimelineCommentsResponse,
  ListTimelinePostsQueryParams,
  ListTimelinePostsResponse,
  ReportTimelineContentBody,
  ReportTimelineContentResponse,
  UnlikeTimelinePostParams,
  UnlikeTimelinePostResponse,
} from "@workspace/api-zod";
import {
  db,
  timelineContentReportsTable,
  timelinePostCommentsTable,
  timelinePostLikesTable,
  timelinePostsTable,
} from "@workspace/db";
import { requireAuth } from "./swamp";

const router: IRouter = Router();
const DEFAULT_POST_PAGE_SIZE = 30;
const DEFAULT_COMMENT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

type TimelineCursor = { createdAt: Date; id: string };

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
  const [likeCounts, commentCounts, ownLikes, ownReports] = await Promise.all([
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
  ]);
  const likesByPost = new Map(likeCounts.map((row) => [row.postId, row.value]));
  const commentsByPost = new Map(commentCounts.map((row) => [row.postId, row.value]));
  const likedPostIds = new Set(ownLikes.map((row) => row.postId));
  const reportedPostIds = new Set(ownReports.map((row) => row.subjectId));
  return rows.map((row) => ({
    ...row,
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
  const ownReports = await db
    .select({ subjectId: timelineContentReportsTable.subjectId })
    .from(timelineContentReportsTable)
    .where(and(
      eq(timelineContentReportsTable.subjectType, "comment"),
      inArray(timelineContentReportsTable.subjectId, rows.map((row) => row.id)),
      eq(timelineContentReportsTable.walletAddress, walletAddress),
    ));
  const reportedCommentIds = new Set(ownReports.map((row) => row.subjectId));
  return rows.map((row) => ({
    ...row,
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
    const inserted = await db
      .insert(timelinePostsTable)
      .values({
        id: `post-${randomUUID()}`,
        authorAddress: walletAddress,
        body: parsed.data.body.trim(),
      })
      .returning();
    const post = (await serializePosts(inserted, walletAddress))[0];
    res.status(201).json(CreateTimelinePostResponse.parse(post));
  } catch {
    res.status(500).json({ error: "Unable to publish this post." });
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
    if (!(await postExists(postId))) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (shouldLike) {
      await db
        .insert(timelinePostLikesTable)
        .values({ postId, walletAddress })
        .onConflictDoNothing();
    } else {
      await db
        .delete(timelinePostLikesTable)
        .where(and(
          eq(timelinePostLikesTable.postId, postId),
          eq(timelinePostLikesTable.walletAddress, walletAddress),
        ));
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
    if (!(await postExists(path.data.postId))) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    const inserted = await db
      .insert(timelinePostCommentsTable)
      .values({
        id: `comment-${randomUUID()}`,
        postId: path.data.postId,
        authorAddress: walletAddress,
        body: body.data.body.trim(),
      })
      .returning();
    res.status(201).json(CreateTimelineCommentResponse.parse({
      ...inserted[0],
      reportedByMe: false,
    }));
  } catch {
    res.status(500).json({ error: "Unable to publish this comment." });
  }
});

export default router;
