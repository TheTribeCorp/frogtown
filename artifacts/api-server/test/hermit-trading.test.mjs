import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHermitBuyTransaction,
  buildHermitTrustlineTransaction,
  formatIssuedAmount,
  getHermitBuyQuote,
  createHermitXamanPayload,
  HERMIT_CURRENCY,
  HERMIT_ISSUER,
  HERMIT_TRUSTLINE_LIMIT,
  HermitTradingError,
} from "../src/lib/hermit-trading.ts";

test("issued amounts are formatted as plain XRPL decimal strings", () => {
  assert.equal(formatIssuedAmount(0.00000000012345678), "0.00000000012345678");
  assert.equal(formatIssuedAmount(1_000_000_000), "1000000000");
  assert.equal(formatIssuedAmount(12.34000000000001), "12.34");
});

test("AMM quote includes the fee, slippage floor, and XRP drop amount", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.method, "amm_info");
    assert.equal(request.params[0].asset.currency, "XRP");
    assert.equal(request.params[0].asset2.issuer, HERMIT_ISSUER);
    return new Response(JSON.stringify({
      result: {
        amm: {
          amount: "170785870",
          amount2: {
            currency: HERMIT_CURRENCY,
            issuer: HERMIT_ISSUER,
            value: "280619658.1421212",
          },
          trading_fee: 236,
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const quote = await getHermitBuyQuote("1", 500);
    assert.equal(quote.xrpAmount, "1");
    assert.equal(quote.xrpDrops, "1000000");
    assert.equal(quote.slippageBps, 500);
    assert.equal(quote.ammFeeBps, 24);
    assert.ok(Number(quote.expectedHermit) > Number(quote.minimumHermit));
    assert.ok(quote.priceImpactPercent > 0);

    const transaction = buildHermitBuyTransaction(quote);
    assert.equal(transaction.TransactionType, "OfferCreate");
    assert.equal(transaction.Flags, 0x00020000);
    assert.equal(transaction.TakerGets, "1000000");
    assert.equal(transaction.TakerPays.currency, HERMIT_CURRENCY);
    assert.equal(transaction.TakerPays.issuer, HERMIT_ISSUER);
    assert.equal(transaction.TakerPays.value, quote.minimumHermit);
    assert.equal("Account" in transaction, false, "Xaman fills the signing account itself");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buy quote rejects invalid amounts and unsafe slippage settings", async () => {
  await assert.rejects(
    () => getHermitBuyQuote("0.001", 500),
    (error) => error instanceof HermitTradingError && error.statusCode === 400,
  );
  await assert.rejects(
    () => getHermitBuyQuote("1.0000001", 500),
    (error) => error instanceof HermitTradingError && error.statusCode === 400,
  );
  await assert.rejects(
    () => getHermitBuyQuote("1", 2_001),
    (error) => error instanceof HermitTradingError && error.statusCode === 400,
  );
});

test("trustline request names the exact $HERMIT issuer and a capped line limit", () => {
  assert.deepEqual(buildHermitTrustlineTransaction(), {
    TransactionType: "TrustSet",
    LimitAmount: {
      currency: HERMIT_CURRENCY,
      issuer: HERMIT_ISSUER,
      value: HERMIT_TRUSTLINE_LIMIT,
    },
  });
});

test("Xaman creates a mainnet approval payload without assigning the signing account", async () => {
  const originalFetch = globalThis.fetch;
  process.env.XAMAN_API_KEY = "test-xaman-key";
  process.env.XAMAN_API_SECRET = "test-xaman-secret";
  const walletAddress = "rFrogtownTestWallet";
  let requestBody;

  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    assert.equal(init?.headers?.["X-API-Key"], "test-xaman-key");
    assert.equal(init?.headers?.["X-API-Secret"], "test-xaman-secret");
    return new Response(JSON.stringify({
      uuid: "payload-id",
      refs: {
        qr_png: "https://xumm.app/qr/payload-id",
        websocket_status: "wss://xumm.app/sign/payload-id",
      },
      next: { always: "https://xumm.app/sign/payload-id" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const payload = await createHermitXamanPayload(
      "trustline",
      walletAddress,
      buildHermitTrustlineTransaction(),
      null,
    );
    assert.equal(payload.payloadId, "payload-id");
    assert.equal(payload.transactionType, "trustline");
    assert.equal(requestBody.options.submit, true);
    assert.equal(requestBody.options.expire, 5);
    assert.equal(requestBody.options.force_network, "MAINNET");
    assert.equal(requestBody.txjson.TransactionType, "TrustSet");
    assert.equal("Account" in requestBody.txjson, false);
    assert.match(requestBody.custom_meta.instruction, new RegExp(walletAddress));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.XAMAN_API_KEY;
    delete process.env.XAMAN_API_SECRET;
  }
});
