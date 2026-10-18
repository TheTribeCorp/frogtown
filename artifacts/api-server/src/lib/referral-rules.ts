import { createHash } from "node:crypto";

export const REFERRAL_QUALIFYING_QUEST_IDS = [
  "check_in",
  "ledger_minute",
  "community_engagement",
  "room_spotlight",
] as const;

export const REFERRAL_QUALIFYING_POINTS_HUNDREDTHS = 400;
export const REFERRAL_REWARD_HUNDREDTHS = 200;
export const REFERRAL_BURST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REFERRAL_SIGNUP_BURST_THRESHOLD = 5;
export const REFERRAL_QUALIFICATION_BURST_THRESHOLD = 3;

export type ReferralBurstSignal = "signup_burst" | "qualification_burst";

export function classifyReferralBurst(recentReferralCount: number, qualifiedReferralCount: number): ReferralBurstSignal[] {
  const signals: ReferralBurstSignal[] = [];
  if (recentReferralCount >= REFERRAL_SIGNUP_BURST_THRESHOLD) signals.push("signup_burst");
  if (qualifiedReferralCount >= REFERRAL_QUALIFICATION_BURST_THRESHOLD) signals.push("qualification_burst");
  return signals;
}

export function hashReferralDeviceId(deviceId: string) {
  return createHash("sha256").update(deviceId, "utf8").digest("hex");
}

export function hasCompletedReferralDailySet(
  completions: Array<{ questId: string; pointsHundredths: number }>,
) {
  const pointsByQuest = new Map<string, number>();
  for (const completion of completions) {
    if (
      REFERRAL_QUALIFYING_QUEST_IDS.includes(
        completion.questId as (typeof REFERRAL_QUALIFYING_QUEST_IDS)[number],
      )
    ) {
      pointsByQuest.set(
        completion.questId,
        Math.max(pointsByQuest.get(completion.questId) ?? 0, completion.pointsHundredths),
      );
    }
  }

  return REFERRAL_QUALIFYING_QUEST_IDS.every(
    (questId) => (pointsByQuest.get(questId) ?? 0) >= 100,
  ) && REFERRAL_QUALIFYING_QUEST_IDS.reduce(
    (total, questId) => total + (pointsByQuest.get(questId) ?? 0),
    0,
  ) >= REFERRAL_QUALIFYING_POINTS_HUNDREDTHS;
}
