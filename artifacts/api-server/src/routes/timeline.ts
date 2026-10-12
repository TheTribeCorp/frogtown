import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
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
  ListTimelineCommentsResponse,
  ListTimelinePostsResponse,
  UnlikeTimelinePostParams,
  UnlikeTimelinePostResponse,
} from "@workspace/api-zod";
import {
  db,
  timelinePostCommentsTable,
  timelinePostLikesTable,
  timelinePostsTable,
} from "@workspace/db";
import { requireAuth } from "./swamp";

const router: IRouter = Router();

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
  const [likeCounts, commentCounts, ownLikes] = await Promise.all([
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
  ]);
  const likesByPost = new Map(likeCounts.map((row) => [row.postId, row.value]));
  const commentsByPost = new Map(commentCounts.map((row) => [row.postId, row.value]));
  const likedPostIds = new Set(ownLikes.map((row) => row.postId));
  return rows.map((row) => ({
    ...row,
    likeCount: likesByPost.get(row.id) ?? 0,
    commentCount: commentsByPost.get(row.id) ?? 0,
    likedByMe: likedPostIds.has(row.id),
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
  try {
    const rows = await db
      .select()
      .from(timelinePostsTable)
      .orderBy(desc(timelinePostsTable.createdAt), desc(timelinePostsTable.id))
      .limit(50);
    res.json(ListTimelinePostsResponse.parse(await serializePosts(rows, walletAddress)));
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
  try {
    if (!(await postExists(parsed.data.postId))) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    const comments = await db
      .select()
      .from(timelinePostCommentsTable)
      .where(eq(timelinePostCommentsTable.postId, parsed.data.postId))
      .orderBy(asc(timelinePostCommentsTable.createdAt), asc(timelinePostCommentsTable.id));
    res.json(ListTimelineCommentsResponse.parse(comments));
  } catch {
    res.status(500).json({ error: "Unable to load comments." });
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
    res.status(201).json(CreateTimelineCommentResponse.parse(inserted[0]));
  } catch {
    res.status(500).json({ error: "Unable to publish this comment." });
  }
});

export default router;
