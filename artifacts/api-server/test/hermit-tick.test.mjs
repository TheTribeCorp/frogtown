import assert from "node:assert/strict";
import test from "node:test";
import {
  tickForHermitBalance,
  tickForIssuerBalance,
} from "../src/lib/hermit-tick.ts";

test("holder ticks use the exact 20 million $HERMIT boundary", () => {
  assert.equal(tickForHermitBalance("0"), null);
  assert.equal(tickForHermitBalance("0.0000001"), "green");
  assert.equal(tickForHermitBalance("19999999.99999999"), "green");
  assert.equal(tickForHermitBalance("20000000"), "gold");
  assert.equal(tickForHermitBalance("20000000.00000001"), "gold");
});

test("issuer-perspective trustline balances only award ticks to token holders", () => {
  assert.equal(tickForIssuerBalance("-3332046.5190324"), "green");
  assert.equal(tickForIssuerBalance("-277827962.7602165"), "gold");
  assert.equal(tickForIssuerBalance("0"), null);
  assert.equal(tickForIssuerBalance("3332046.5190324"), null);
  assert.throws(() => tickForIssuerBalance("not-a-balance"), /invalid issued-token balance/i);
});
