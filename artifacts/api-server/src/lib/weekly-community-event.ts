const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const PROMPT_EPOCH = Date.UTC(2024, 0, 1);

const WEEKLY_PROMPTS = [
  "What are you building, learning, or exploring on XRPL this week?",
  "What would make Frogtown more useful to the community?",
  "Share one useful thing you learned about the XRPL ecosystem.",
  "What community project deserves more attention this week?",
  "What is one idea you would like to see the community make real?",
  "What brought you to Frogtown, and what would make you stay?",
] as const;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getWeeklyCommunityEventDetails(now = new Date()) {
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysAfterMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysAfterMonday);

  const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);
  const elapsedWeeks = Math.floor((weekStart.getTime() - PROMPT_EPOCH) / WEEK_MS);
  const promptIndex = ((elapsedWeeks % WEEKLY_PROMPTS.length) + WEEKLY_PROMPTS.length) % WEEKLY_PROMPTS.length;

  return {
    weekStart: isoDay(weekStart),
    weekEnd: isoDay(weekEnd),
    title: "The Weekly Swamp Session",
    prompt: WEEKLY_PROMPTS[promptIndex],
  };
}
