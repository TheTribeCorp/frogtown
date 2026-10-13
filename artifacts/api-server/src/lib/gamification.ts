import { randomInt, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import {
  coinFlipsTable,
  dailyQuestActionsTable,
  dailyQuestCompletionsTable,
  db,
  gamificationProfilesTable,
} from "@workspace/db";

const POINT = 100;
const FROG_BADGE_THRESHOLD = 10_000;
const QUEST_IDS = ["check_in", "ledger_minute", "community_engagement", "room_spotlight"] as const;
type GamificationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type QuestActionType = "timeline_post" | "other_post_like" | "other_post_comment" | "room_message";
export type QuestId = (typeof QUEST_IDS)[number];
export type CoinChoice = "heads" | "tails";

export class InsufficientPointsError extends Error {}
export class CoinFlipRequestConflictError extends Error {}
export class InvalidGamificationHistoryCursorError extends Error {}

export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function previousDayKey(dayKey: string) {
  const day = new Date(`${dayKey}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return utcDayKey(day);
}

function pointsValue(hundredths: number) {
  return Number((hundredths / POINT).toFixed(2));
}

function activeStreak(profile: typeof gamificationProfilesTable.$inferSelect, today: string) {
  if (profile.lastCheckInDay !== today && profile.lastCheckInDay !== previousDayKey(today)) return 0;
  return profile.currentStreak;
}

async function lockProfile(tx: GamificationTransaction, walletAddress: string) {
  await tx.insert(gamificationProfilesTable).values({ walletAddress }).onConflictDoNothing();
  const [profile] = await tx
    .select()
    .from(gamificationProfilesTable)
    .where(eq(gamificationProfilesTable.walletAddress, walletAddress))
    .for("update");
  if (!profile) throw new Error("Unable to load the wallet's Frogtown points profile.");
  return profile;
}

async function addPoints(
  tx: GamificationTransaction,
  walletAddress: string,
  deltaHundredths: number,
) {
  const [updated] = await tx
    .update(gamificationProfilesTable)
    .set({
      pointsHundredths: sql`${gamificationProfilesTable.pointsHundredths} + ${deltaHundredths}`,
      updatedAt: new Date(),
    })
    .where(eq(gamificationProfilesTable.walletAddress, walletAddress))
    .returning();
  if (!updated) throw new Error("Unable to update the wallet's Frogtown points.");
  if (updated.pointsHundredths >= FROG_BADGE_THRESHOLD && !updated.frogBadgeEarnedAt) {
    const [badged] = await tx
      .update(gamificationProfilesTable)
      .set({ frogBadgeEarnedAt: new Date(), updatedAt: new Date() })
      .where(eq(gamificationProfilesTable.walletAddress, walletAddress))
      .returning();
    return badged ?? updated;
  }
  return updated;
}

async function completeQuest(
  tx: GamificationTransaction,
  walletAddress: string,
  dayKey: string,
  questId: QuestId,
) {
  const [completion] = await tx
    .insert(dailyQuestCompletionsTable)
    .values({ walletAddress, dayKey, questId, pointsHundredths: POINT })
    .onConflictDoNothing()
    .returning({ questId: dailyQuestCompletionsTable.questId });
  if (!completion) return false;
  await addPoints(tx, walletAddress, POINT);
  return true;
}

export async function recordDailyQuestActionInTransaction(
  tx: GamificationTransaction,
  walletAddress: string,
  actionType: QuestActionType,
  referenceId?: string,
) {
  await lockProfile(tx, walletAddress);
  const dayKey = utcDayKey();
  await tx
    .insert(dailyQuestActionsTable)
    .values({ walletAddress, dayKey, actionType, referenceId: referenceId ?? null })
    .onConflictDoNothing();

  if (actionType === "timeline_post") {
    await completeQuest(tx, walletAddress, dayKey, "ledger_minute");
  } else if (actionType === "room_message") {
    await completeQuest(tx, walletAddress, dayKey, "room_spotlight");
  } else {
    const actionRows = await tx
      .select({ actionType: dailyQuestActionsTable.actionType })
      .from(dailyQuestActionsTable)
      .where(and(
        eq(dailyQuestActionsTable.walletAddress, walletAddress),
        eq(dailyQuestActionsTable.dayKey, dayKey),
        inArray(dailyQuestActionsTable.actionType, ["other_post_like", "other_post_comment"]),
      ));
    const recordedActions = new Set(actionRows.map((row) => row.actionType));
    if (recordedActions.has("other_post_like") && recordedActions.has("other_post_comment")) {
      await completeQuest(tx, walletAddress, dayKey, "community_engagement");
    }
  }
}

export async function recordDailyQuestAction(
  walletAddress: string,
  actionType: QuestActionType,
  referenceId?: string,
) {
  return db.transaction((tx) => recordDailyQuestActionInTransaction(tx, walletAddress, actionType, referenceId));
}

export async function completeDailyCheckIn(walletAddress: string) {
  const dayKey = utcDayKey();
  return db.transaction(async (tx) => {
    const profile = await lockProfile(tx, walletAddress);
    if (profile.lastCheckInDay === dayKey) return false;

    const currentStreak = profile.lastCheckInDay === previousDayKey(dayKey)
      ? profile.currentStreak + 1
      : 1;
    await tx
      .update(gamificationProfilesTable)
      .set({
        lastCheckInDay: dayKey,
        currentStreak,
        longestStreak: Math.max(profile.longestStreak, currentStreak),
        updatedAt: new Date(),
      })
      .where(eq(gamificationProfilesTable.walletAddress, walletAddress));
    await completeQuest(tx, walletAddress, dayKey, "check_in");
    return true;
  });
}

export async function getGamificationSummary(walletAddress: string) {
  await db.insert(gamificationProfilesTable).values({ walletAddress }).onConflictDoNothing();
  const today = utcDayKey();
  const [profile] = await db
    .select()
    .from(gamificationProfilesTable)
    .where(eq(gamificationProfilesTable.walletAddress, walletAddress));
  if (!profile) throw new Error("Unable to load the wallet's Frogtown points profile.");

  const [completions, actions] = await Promise.all([
    db
      .select({ questId: dailyQuestCompletionsTable.questId })
      .from(dailyQuestCompletionsTable)
      .where(and(
        eq(dailyQuestCompletionsTable.walletAddress, walletAddress),
        eq(dailyQuestCompletionsTable.dayKey, today),
      )),
    db
      .select({ actionType: dailyQuestActionsTable.actionType })
      .from(dailyQuestActionsTable)
      .where(and(
        eq(dailyQuestActionsTable.walletAddress, walletAddress),
        eq(dailyQuestActionsTable.dayKey, today),
      )),
  ]);
  const completed = new Set(completions.map((row) => row.questId));
  const actionSet = new Set(actions.map((row) => row.actionType));
  const tasks = [
    { id: "check_in", completed: completed.has("check_in"), progress: completed.has("check_in") ? 1 : 0, target: 1 },
    { id: "ledger_minute", completed: completed.has("ledger_minute"), progress: completed.has("ledger_minute") ? 1 : 0, target: 1 },
    {
      id: "community_engagement",
      completed: completed.has("community_engagement"),
      progress: Number(actionSet.has("other_post_like")) + Number(actionSet.has("other_post_comment")),
      target: 2,
    },
    { id: "room_spotlight", completed: completed.has("room_spotlight"), progress: completed.has("room_spotlight") ? 1 : 0, target: 1 },
  ];
  return {
    dayKey: today,
    points: pointsValue(profile.pointsHundredths),
    currentStreak: activeStreak(profile, today),
    longestStreak: profile.longestStreak,
    frogBadgeEarned: Boolean(profile.frogBadgeEarnedAt),
    frogBadgeEarnedAt: profile.frogBadgeEarnedAt?.toISOString() ?? null,
    tasks,
  };
}

export async function getGamificationLeaderboard() {
  const today = utcDayKey();
  const profiles = await db
    .select()
    .from(gamificationProfilesTable)
    .where(gt(gamificationProfilesTable.pointsHundredths, 0))
    .orderBy(desc(gamificationProfilesTable.pointsHundredths), asc(gamificationProfilesTable.walletAddress))
    .limit(10);
  return {
    items: profiles.map((profile, index) => ({
      rank: index + 1,
      walletAddress: profile.walletAddress,
      points: pointsValue(profile.pointsHundredths),
      currentStreak: activeStreak(profile, today),
      frogBadgeEarned: Boolean(profile.frogBadgeEarnedAt),
    })),
  };
}

type GamificationHistoryCursor = { createdAt: Date; id: string };
type GamificationHistoryItem = {
  id: string;
  kind: "quest" | "coin_flip";
  description: string;
  createdAt: string;
  pointsChange: number;
  choice: CoinChoice | null;
  result: CoinChoice | null;
  won: boolean | null;
  stakePoints: number | null;
  payoutPoints: number | null;
};

function decodeGamificationHistoryCursor(value?: string): GamificationHistoryCursor | null {
  if (!value) return null;
  try {
    if (value.length > 512) throw new Error("Cursor is too long.");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    if (!createdAt || !Number.isFinite(createdAt.getTime()) || typeof parsed.id !== "string" || parsed.id.length > 256) {
      throw new Error("Cursor is invalid.");
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new InvalidGamificationHistoryCursorError();
  }
}

function encodeGamificationHistoryCursor(value: GamificationHistoryCursor) {
  return Buffer.from(JSON.stringify({
    createdAt: value.createdAt.toISOString(),
    id: value.id,
  })).toString("base64url");
}

export async function getGamificationHistory(
  walletAddress: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const cursor = decodeGamificationHistoryCursor(options.cursor);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const questEventId = sql<string>`concat('quest:', ${dailyQuestCompletionsTable.dayKey}, ':', ${dailyQuestCompletionsTable.questId})`;
  const flipEventId = sql<string>`concat('flip:', ${coinFlipsTable.id})`;
  const questCreatedAtBucket = sql<Date>`date_trunc('milliseconds', ${dailyQuestCompletionsTable.completedAt})`;
  const flipCreatedAtBucket = sql<Date>`date_trunc('milliseconds', ${coinFlipsTable.createdAt})`;
  const questCursorFilter = cursor
    ? or(
      lt(questCreatedAtBucket, cursor.createdAt),
      and(
        eq(questCreatedAtBucket, cursor.createdAt),
        lt(questEventId, cursor.id),
      ),
    )
    : undefined;
  const flipCursorFilter = cursor
    ? or(
      lt(flipCreatedAtBucket, cursor.createdAt),
      and(
        eq(flipCreatedAtBucket, cursor.createdAt),
        lt(flipEventId, cursor.id),
      ),
    )
    : undefined;
  const [quests, flips] = await Promise.all([
    db
      .select()
      .from(dailyQuestCompletionsTable)
      .where(and(
        eq(dailyQuestCompletionsTable.walletAddress, walletAddress),
        questCursorFilter,
      ))
      .orderBy(desc(questCreatedAtBucket), desc(questEventId))
      .limit(limit + 1),
    db
      .select()
      .from(coinFlipsTable)
      .where(and(
        eq(coinFlipsTable.walletAddress, walletAddress),
        flipCursorFilter,
      ))
      .orderBy(desc(flipCreatedAtBucket), desc(flipEventId))
      .limit(limit + 1),
  ]);
  const questTitles: Record<string, string> = {
    check_in: "Daily check-in",
    ledger_minute: "Timeline post",
    community_engagement: "Like and comment",
    room_spotlight: "Community room message",
  };
  const items: GamificationHistoryItem[] = [
    ...quests.map((quest) => ({
      id: `quest:${quest.dayKey}:${quest.questId}`,
      kind: "quest" as const,
      description: questTitles[quest.questId] ?? "Daily quest",
      createdAt: quest.completedAt.toISOString(),
      pointsChange: pointsValue(quest.pointsHundredths),
      choice: null,
      result: null,
      won: null,
      stakePoints: null,
      payoutPoints: null,
    })),
    ...flips.map((flip) => ({
      id: `flip:${flip.id}`,
      kind: "coin_flip" as const,
      description: flip.won ? "Coin flip won" : "Coin flip lost",
      createdAt: flip.createdAt.toISOString(),
      pointsChange: pointsValue(flip.netChangeHundredths),
      choice: flip.choice as CoinChoice,
      result: flip.result as CoinChoice,
      won: flip.won,
      stakePoints: pointsValue(flip.stakeHundredths),
      payoutPoints: pointsValue(flip.payoutHundredths),
    })),
  ].sort((left, right) => {
    const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return timeDifference || right.id.localeCompare(left.id);
  });
  const pageItems = items.slice(0, limit);
  const hasMore = items.length > limit;
  const last = pageItems[pageItems.length - 1];
  return {
    items: pageItems,
    nextCursor: hasMore && last
      ? encodeGamificationHistoryCursor({ createdAt: new Date(last.createdAt), id: last.id })
      : null,
  };
}

export async function playCoinFlip(walletAddress: string, requestId: string, choice: CoinChoice) {
  return db.transaction(async (tx) => {
    const profile = await lockProfile(tx, walletAddress);
    const [existing] = await tx
      .select()
      .from(coinFlipsTable)
      .where(and(
        eq(coinFlipsTable.walletAddress, walletAddress),
        eq(coinFlipsTable.requestId, requestId),
      ));
    if (existing) {
      if (existing.choice !== choice) throw new CoinFlipRequestConflictError();
      const [latestProfile] = await tx
        .select()
        .from(gamificationProfilesTable)
        .where(eq(gamificationProfilesTable.walletAddress, walletAddress));
      return {
        id: existing.id,
        requestId: existing.requestId,
        choice: existing.choice as CoinChoice,
        result: existing.result as CoinChoice,
        won: existing.won,
        stakePoints: pointsValue(existing.stakeHundredths),
        payoutPoints: pointsValue(existing.payoutHundredths),
        netChangePoints: pointsValue(existing.netChangeHundredths),
        points: pointsValue(latestProfile?.pointsHundredths ?? profile.pointsHundredths),
        frogBadgeEarned: Boolean(latestProfile?.frogBadgeEarnedAt),
        frogBadgeEarnedAt: latestProfile?.frogBadgeEarnedAt?.toISOString() ?? null,
        createdAt: existing.createdAt.toISOString(),
      };
    }
    if (profile.pointsHundredths < POINT) throw new InsufficientPointsError();

    const result: CoinChoice = randomInt(0, 2) === 0 ? "heads" : "tails";
    const won = result === choice;
    const stakeHundredths = POINT;
    const payoutHundredths = won ? 180 : 0;
    const netChangeHundredths = won ? 80 : -POINT;
    const updated = await addPoints(tx, walletAddress, netChangeHundredths);
    const [flip] = await tx
      .insert(coinFlipsTable)
      .values({
        id: `flip-${randomUUID()}`,
        walletAddress,
        requestId,
        choice,
        result,
        won,
        stakeHundredths,
        payoutHundredths,
        netChangeHundredths,
      })
      .returning();
    return {
      id: flip.id,
      requestId: flip.requestId,
      choice,
      result,
      won,
      stakePoints: pointsValue(stakeHundredths),
      payoutPoints: pointsValue(payoutHundredths),
      netChangePoints: pointsValue(netChangeHundredths),
      points: pointsValue(updated.pointsHundredths),
      frogBadgeEarned: Boolean(updated.frogBadgeEarnedAt),
      frogBadgeEarnedAt: updated.frogBadgeEarnedAt?.toISOString() ?? null,
      createdAt: flip.createdAt.toISOString(),
    };
  });
}
