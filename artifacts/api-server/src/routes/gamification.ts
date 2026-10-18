import { Router, type IRouter } from "express";
import {
  CheckInGamificationResponse,
  GetGamificationHistoryQueryParams,
  GetGamificationHistoryResponse,
  GetGamificationLeaderboardResponse,
  GetGamificationReferralsResponse,
  GetGamificationSummaryResponse,
  GetGamificationWeeklyEventResponse,
  ListGamificationReferralBurstsResponse,
  PlayGamificationCoinFlipBody,
  PlayGamificationCoinFlipResponse,
} from "@workspace/api-zod";
import { db, walletProfilesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  completeDailyCheckIn,
  CoinFlipRequestConflictError,
  getGamificationHistory,
  getGamificationLeaderboard,
  getGamificationSummary,
  getWeeklyCommunityEvent,
  getReferralBurstReview,
  getReferralSummary,
  InsufficientPointsError,
  InvalidGamificationHistoryCursorError,
  playCoinFlip,
} from "../lib/gamification";
import { requireModerator } from "../lib/moderator-auth";
import { requireAuth } from "./swamp";

const router: IRouter = Router();

router.get("/gamification/summary", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  try {
    res.json(GetGamificationSummaryResponse.parse(await getGamificationSummary(walletAddress)));
  } catch {
    res.status(500).json({ error: "Unable to load daily quests and points." });
  }
});

router.get("/gamification/weekly-event", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  try {
    res.json(GetGamificationWeeklyEventResponse.parse(await getWeeklyCommunityEvent(walletAddress)));
  } catch (error) {
    req.log.error({ err: error }, "Could not load weekly community event.");
    res.status(500).json({ error: "Unable to load this week's community event." });
  }
});

router.get("/gamification/history", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const query = GetGamificationHistoryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "History page size or cursor is invalid." });
    return;
  }
  try {
    res.json(GetGamificationHistoryResponse.parse(
      await getGamificationHistory(walletAddress, query.data),
    ));
  } catch (error) {
    if (error instanceof InvalidGamificationHistoryCursorError) {
      res.status(400).json({ error: "History cursor is invalid." });
      return;
    }
    res.status(500).json({ error: "Unable to load points history." });
  }
});

router.post("/gamification/check-in", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  try {
    await completeDailyCheckIn(walletAddress);
    res.json(CheckInGamificationResponse.parse(await getGamificationSummary(walletAddress)));
  } catch {
    res.status(500).json({ error: "Unable to record today's check-in." });
  }
});

router.get("/gamification/leaderboard", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  try {
    const leaderboard = await getGamificationLeaderboard();
    const addresses = leaderboard.items.map((item) => item.walletAddress);
    const profiles = addresses.length > 0
      ? await db
        .select({
          walletAddress: walletProfilesTable.walletAddress,
          username: walletProfilesTable.username,
        })
        .from(walletProfilesTable)
        .where(inArray(walletProfilesTable.walletAddress, addresses))
      : [];
    const usernamesByWallet = new Map(profiles.map((profile) => [profile.walletAddress, profile.username]));
    res.json(GetGamificationLeaderboardResponse.parse({
      items: leaderboard.items.map((item) => ({
        ...item,
        username: usernamesByWallet.get(item.walletAddress) ?? null,
      })),
    }));
  } catch {
    res.status(500).json({ error: "Unable to load the points leaderboard." });
  }
});

router.get("/gamification/referrals", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  try {
    const referrals = await getReferralSummary(walletAddress);
    const addresses = referrals.leaderboard.map((item) => item.walletAddress);
    const profiles = addresses.length > 0
      ? await db
        .select({
          walletAddress: walletProfilesTable.walletAddress,
          username: walletProfilesTable.username,
        })
        .from(walletProfilesTable)
        .where(inArray(walletProfilesTable.walletAddress, addresses))
      : [];
    const usernamesByWallet = new Map(profiles.map((profile) => [profile.walletAddress, profile.username]));
    res.json(GetGamificationReferralsResponse.parse({
      referralCount: referrals.referralCount,
      pendingReferralCount: referrals.pendingReferralCount,
      rewardPoints: referrals.rewardPoints,
      myReferralQualification: referrals.myReferralQualification,
      leaderboard: referrals.leaderboard.map((item, index) => ({
        ...item,
        rank: index + 1,
        username: usernamesByWallet.get(item.walletAddress) ?? null,
      })),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not load referral standings.");
    res.status(500).json({ error: "Unable to load referral standings." });
  }
});

router.get("/gamification/moderation/referral-bursts", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress || !requireModerator(walletAddress, res, "review referral activity")) return;
  try {
    res.json(ListGamificationReferralBurstsResponse.parse(await getReferralBurstReview()));
  } catch (error) {
    req.log.error({ err: error }, "Could not load referral burst review.");
    res.status(500).json({ error: "Unable to load referral activity review." });
  }
});

router.post("/gamification/coin-flips", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const input = PlayGamificationCoinFlipBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Choose heads or tails and provide a valid request ID." });
    return;
  }
  try {
    res.json(PlayGamificationCoinFlipResponse.parse(
      await playCoinFlip(walletAddress, input.data.requestId, input.data.choice),
    ));
  } catch (error) {
    if (error instanceof InsufficientPointsError) {
      res.status(409).json({ error: "You need at least 1 point to flip the coin." });
      return;
    }
    if (error instanceof CoinFlipRequestConflictError) {
      res.status(409).json({ error: "This flip request ID was already used for a different choice." });
      return;
    }
    res.status(500).json({ error: "Unable to resolve this coin flip." });
  }
});

export default router;
