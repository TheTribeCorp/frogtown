import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUsername } from "../src/lib/wallet-username.ts";

test("username rules enforce 4–17 letters, numbers, and underscores", () => {
  assert.equal(normalizeUsername("Frog_7"), "frog_7");
  assert.equal(normalizeUsername("a123"), "a123");
  assert.equal(normalizeUsername("frog_town_123456"), "frog_town_123456");
  assert.equal(normalizeUsername("abc"), null);
  assert.equal(normalizeUsername("frog town"), null);
  assert.equal(normalizeUsername("name-too-long-123"), null);
});
