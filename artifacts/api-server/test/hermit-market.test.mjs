import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGeckoTerminalMarketData } from "../src/lib/hermit-market.ts";

test("market data selects the most liquid priced pool and preserves its market cap", () => {
  const snapshot = parseGeckoTerminalMarketData({
    data: [
      { attributes: { token_price_usd: "0.000002", market_cap_usd: "2000", reserve_in_usd: "50" } },
      { attributes: { token_price_usd: "0.000001", market_cap_usd: "1000", reserve_in_usd: "500" } },
      { attributes: { token_price_usd: "0", market_cap_usd: "0", reserve_in_usd: "9000" } },
    ],
  }, new Date("2026-10-18T12:00:00.000Z"));

  assert.deepEqual(snapshot, {
    priceUsd: 0.000001,
    marketCapUsd: 1000,
    updatedAt: "2026-10-18T12:00:00.000Z",
    isStale: false,
    source: "GeckoTerminal",
  });
});

test("market data rejects empty or malformed pool lists", () => {
  assert.throws(() => parseGeckoTerminalMarketData({ data: [] }), /no priced/);
  assert.throws(() => parseGeckoTerminalMarketData({ results: [] }), /invalid market-data/);
});
