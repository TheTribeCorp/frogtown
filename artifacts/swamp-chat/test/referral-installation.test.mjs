import assert from "node:assert/strict";
import { test } from "node:test";
import { getReferralInstallationId } from "../src/lib/referral-installation.ts";

test("referral installation ID is created once and reused by this browser storage", () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    crypto: { randomUUID: () => "11a22b33-c444-4d55-8e66-77889900aabb" },
  };
  assert.equal(getReferralInstallationId(), "11a22b33-c444-4d55-8e66-77889900aabb");
  assert.equal(getReferralInstallationId(), "11a22b33-c444-4d55-8e66-77889900aabb");
  delete globalThis.window;
});

test("referral installation ID fails closed when browser storage is unavailable", () => {
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); },
    },
    crypto: { randomUUID: () => "11a22b33-c444-4d55-8e66-77889900aabb" },
  };
  assert.equal(getReferralInstallationId(), null);
  delete globalThis.window;
});
