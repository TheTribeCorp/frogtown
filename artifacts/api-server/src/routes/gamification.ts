import { Router, type IRouter } from "express";
import {
  CheckInGamificationResponse,
  GetGamificationHistoryQueryParams,
  GetGamificationHistoryResponse,
  GetGamificationLeaderboardResponse,
  GetGamificationSummaryResponse,
  PlayGamificationCoinFlipBody,
  PlayGamificationCoinFlipResponse,
} from "@workspace/api-zod";
import {
  completeDailyCheckIn,
  CoinFlipRequestConflictError,
  getGamificationHistory,
  getGamificationLeaderboard,
  getGamificationSummary,
  InsufficientPointsError,
  InvalidGamificationHistoryCursorError,
  playCoinFlip,
} from "../lib/gamification";
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
    res.json(GetGamificationLeaderboardResponse.parse(await getGamificationLeaderboard()));
  } catch {
    res.status(500).json({ error: "Unable to load the points leaderboard." });
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
