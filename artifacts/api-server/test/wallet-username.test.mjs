import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUsername } from "../src/lib/wallet-username.ts";
import { walletIdentityMatches } from "../src/lib/wallet-identity.ts";

test("username rules enforce 4–17 letters, numbers, and underscores", () => {
  assert.equal(normalizeUsername("Frog_7"), "frog_7");
  assert.equal(normalizeUsername("a123"), "a123");
  assert.equal(normalizeUsername("frog_town_123456"), "frog_town_123456");
  assert.equal(normalizeUsername("abc"), null);
  assert.equal(normalizeUsername("frog town"), null);
  assert.equal(normalizeUsername("name-too-long-123"), null);
});

test("wallet identity matching ignores EVM checksum casing but preserves XRPL case", () => {
  const evmLowercase = `0x${"a".repeat(40)}`;
  const evmChecksum = `0x${"A".repeat(40)}`;
  const xrplAddress = `r${"a".repeat(24)}`;

  assert.equal(walletIdentityMatches(evmLowercase, evmChecksum), true);
  assert.equal(walletIdentityMatches(xrplAddress, xrplAddress), true);
  assert.equal(walletIdentityMatches(xrplAddress, `r${"A".repeat(24)}`), false);
  assert.equal(walletIdentityMatches(evmLowercase, xrplAddress), false);
  assert.equal(walletIdentityMatches("not-a-wallet", evmLowercase), false);
});
