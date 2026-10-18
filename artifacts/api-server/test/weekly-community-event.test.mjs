import assert from "node:assert/strict";
import { test } from "node:test";
import { getWeeklyCommunityEventDetails } from "../src/lib/weekly-community-event.ts";

test("weekly event uses Monday-to-Sunday UTC windows", () => {
  assert.deepEqual(
    getWeeklyCommunityEventDetails(new Date("2026-10-18T23:59:00.000Z")),
    {
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      title: "The Weekly Swamp Session",
      prompt: "What would make Frogtown more useful to the community?",
    },
  );
  assert.deepEqual(
    getWeeklyCommunityEventDetails(new Date("2026-10-19T00:00:00.000Z")),
    {
      weekStart: "2026-10-19",
      weekEnd: "2026-10-25",
      title: "The Weekly Swamp Session",
      prompt: "Share one useful thing you learned about the XRPL ecosystem.",
    },
  );
});

test("the event prompt stays the same for the full UTC week", () => {
  const monday = getWeeklyCommunityEventDetails(new Date("2026-10-12T00:00:00.000Z"));
  const sunday = getWeeklyCommunityEventDetails(new Date("2026-10-18T23:59:59.999Z"));
  assert.equal(monday.prompt, sunday.prompt);
  assert.notEqual(monday.prompt, getWeeklyCommunityEventDetails(new Date("2026-10-19T00:00:00.000Z")).prompt);
});
