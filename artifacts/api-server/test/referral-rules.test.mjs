import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasCompletedReferralDailySet,
  hashReferralDeviceId,
  REFERRAL_QUALIFYING_QUEST_IDS,
} from "../src/lib/referral-rules.ts";

const allQuests = REFERRAL_QUALIFYING_QUEST_IDS.map((questId) => ({
  questId,
  pointsHundredths: 100,
}));

test("referral qualification requires all four daily quests worth one point each", () => {
  assert.equal(hasCompletedReferralDailySet(allQuests), true);
  assert.equal(hasCompletedReferralDailySet(allQuests.slice(1)), false);
  assert.equal(hasCompletedReferralDailySet([
    ...allQuests.slice(0, 3),
    { questId: "check_in", pointsHundredths: 100 },
  ]), false);
  assert.equal(hasCompletedReferralDailySet([
    ...allQuests.slice(0, 3),
    { questId: "room_spotlight", pointsHundredths: 99 },
  ]), false);
});

test("referral installation IDs are stored as stable one-way hashes", () => {
  const first = hashReferralDeviceId("same-browser-installation");
  assert.equal(first, hashReferralDeviceId("same-browser-installation"));
  assert.notEqual(first, hashReferralDeviceId("different-browser-installation"));
  assert.match(first, /^[a-f0-9]{64}$/);
});
