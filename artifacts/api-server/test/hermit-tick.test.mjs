import assert from "node:assert/strict";
import test from "node:test";
import {
  getWalletHermitTick,
  hermitTickCacheControl,
  tickForHermitBalance,
  tickForIssuerBalance,
} from "../src/lib/hermit-tick.ts";

test("holder checks use short edge caching only for verified public results", () => {
  assert.equal(
    hermitTickCacheControl("checked", false),
    "public, max-age=0, s-maxage=30, stale-while-revalidate=15",
  );
  assert.equal(hermitTickCacheControl("checked", true), "no-store");
  assert.equal(hermitTickCacheControl("unavailable", false), "no-store");
});

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

function syntheticWallet(index) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = index;
  let suffix = "";
  do {
    suffix = alphabet[value % alphabet.length] + suffix;
    value = Math.floor(value / alphabet.length);
  } while (value > 0);
  return `r${suffix.padStart(24, "1")}`;
}

function emptyTrustlineResponse() {
  return new Response(JSON.stringify({ result: { lines: [] } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function xrplResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("successful XRPL holder checks award the tick from the issuer-side trustline", async () => {
  const originalFetch = globalThis.fetch;
  const wallet = syntheticWallet(3_001);
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(String(init?.body)) };
    return xrplResponse({
      result: {
        lines: [{
          account: wallet,
          currency: "4845524D49540000000000000000000000000000",
          balance: "-42.5",
        }],
      },
    });
  };

  try {
    const check = await getWalletHermitTick(wallet);
    assert.equal(check.tick, "green");
    assert.equal(check.checkStatus, "checked");
    assert.equal(request.body.method, "account_lines");
    assert.equal(request.body.params[0].account, "r95w8bhxwgLTNC8V2j3Fv9yPuwaQfMjYL3");
    assert.equal(request.body.params[0].peer, wallet);
    assert.equal(request.body.params[0].ledger_index, "validated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a successful XRPL lookup with no $HERMIT trustline has no tick", async () => {
  const originalFetch = globalThis.fetch;
  const wallet = syntheticWallet(3_002);
  globalThis.fetch = async () => xrplResponse({ result: { lines: [] } });

  try {
    const check = await getWalletHermitTick(wallet);
    assert.equal(check.tick, null);
    assert.equal(check.checkStatus, "checked");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XRPL timeouts fail closed without awarding a tick", async () => {
  const originalFetch = globalThis.fetch;
  const wallet = syntheticWallet(3_003);
  globalThis.fetch = async (_url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    const timeout = new Error("XRPL request timed out");
    timeout.name = "TimeoutError";
    throw timeout;
  };

  try {
    const check = await getWalletHermitTick(wallet);
    assert.equal(check.tick, null);
    assert.equal(check.checkStatus, "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed XRPL responses fail closed without awarding a tick", async () => {
  const originalFetch = globalThis.fetch;
  const malformedResponses = [
    new Response("not-json", { status: 200 }),
    xrplResponse({}),
    xrplResponse({ result: { lines: {} } }),
    xrplResponse({
      result: {
        lines: [{
          account: syntheticWallet(3_007),
          currency: "4845524D49540000000000000000000000000000",
          balance: "NaN",
        }],
      },
    }),
  ];
  globalThis.fetch = async () => malformedResponses.shift();

  try {
    for (let index = 0; index < 4; index += 1) {
      const check = await getWalletHermitTick(syntheticWallet(3_004 + index));
      assert.equal(check.tick, null, `malformed response ${index + 1} must not award a tick`);
      assert.equal(check.checkStatus, "unavailable");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forced wallet refresh bypasses a successful cached lookup", async () => {
  const originalFetch = globalThis.fetch;
  const wallet = syntheticWallet(3_010);
  const balances = ["-19", "-20000000"];
  let networkCalls = 0;
  globalThis.fetch = async () => {
    const balance = balances[networkCalls];
    networkCalls += 1;
    return xrplResponse({
      result: {
        lines: [{
          account: wallet,
          currency: "4845524D49540000000000000000000000000000",
          balance,
        }],
      },
    });
  };

  try {
    const cachedCheck = await getWalletHermitTick(wallet);
    assert.equal(cachedCheck.tick, "green");
    assert.equal(networkCalls, 1);

    const refreshedCheck = await getWalletHermitTick(wallet, true);
    assert.equal(refreshedCheck.tick, "gold");
    assert.equal(refreshedCheck.checkStatus, "checked");
    assert.equal(networkCalls, 2, "forced refresh must make a new XRPL request");

    const laterPublicCheck = await getWalletHermitTick(wallet);
    assert.equal(laterPublicCheck.tick, "gold");
    assert.equal(networkCalls, 2, "the successful refresh should replace the cached result");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public lookup bursts have bounded concurrency and a finite queue", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let peakActive = 0;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return emptyTrustlineResponse();
  };

  try {
    const checks = await Promise.all(
      Array.from({ length: 80 }, (_, index) => getWalletHermitTick(syntheticWallet(index))),
    );
    assert.equal(peakActive, 6, "public traffic should use no more than six concurrent XRPL slots");
    assert.equal(networkCalls, 70, "six active plus 64 queued lookups should be admitted");
    assert.equal(checks.filter((check) => check.checkStatus === "unavailable").length, 10);
    assert.ok(checks.every((check) => check.checkStatus === "checked" || check.tick === null));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh signed-in checks use reserved capacity and coalesce duplicates", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let peakActive = 0;
  let refreshCalls = 0;
  let releasePublicLookups;
  let signalRefreshStarted;
  const publicGate = new Promise((resolve) => { releasePublicLookups = resolve; });
  const refreshStarted = new Promise((resolve) => { signalRefreshStarted = resolve; });
  const refreshWallet = syntheticWallet(10_000);

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const peer = body.params[0].peer;
    active += 1;
    peakActive = Math.max(peakActive, active);
    if (peer === refreshWallet) {
      refreshCalls += 1;
      signalRefreshStarted();
    } else {
      await publicGate;
    }
    active -= 1;
    return emptyTrustlineResponse();
  };

  try {
    const publicChecks = Array.from({ length: 6 }, (_, index) =>
      getWalletHermitTick(syntheticWallet(20_000 + index)),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(active, 6, "public lookup slots should be occupied");

    const refreshOne = getWalletHermitTick(refreshWallet, true);
    const refreshTwo = getWalletHermitTick(refreshWallet, true);
    await Promise.race([
      refreshStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("fresh check was blocked")), 500)),
    ]);
    assert.equal(refreshCalls, 1, "duplicate fresh checks for one wallet should share one XRPL request");
    assert.ok(peakActive <= 8);

    releasePublicLookups();
    const [freshCheck, ...publicResults] = await Promise.all([
      refreshOne,
      refreshTwo,
      ...publicChecks,
    ]);
    assert.equal(freshCheck.checkStatus, "checked");
    assert.ok(publicResults.every((check) => check.checkStatus === "checked"));
  } finally {
    releasePublicLookups();
    globalThis.fetch = originalFetch;
  }
});
