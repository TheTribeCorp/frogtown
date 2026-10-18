import { randomUUID } from "node:crypto";

export const HERMIT_ISSUER = "r95w8bhxwgLTNC8V2j3Fv9yPuwaQfMjYL3";
export const HERMIT_CURRENCY = "4845524D49540000000000000000000000000000";
export const HERMIT_TRUSTLINE_LIMIT = "1000000000";

const XRPL_MAINNET_RPC = "https://s1.ripple.com:51234/";
const XAMAN_PAYLOAD_URL = "https://xumm.app/api/v1/platform/payload";
const XRPL_OFFER_CREATE_IMMEDIATE_OR_CANCEL = 0x00020000;
const XRP_DROPS_PER_XRP = 1_000_000n;
const MIN_XRP_AMOUNT = 0.01;
const MAX_XRP_AMOUNT = 1_000;
const XRPL_TX_URL = "https://s1.ripple.com:51234/";

export type HermitBuyQuote = {
  xrpAmount: string;
  expectedHermit: string;
  minimumHermit: string;
  priceImpactPercent: number;
  slippageBps: number;
  ammFeeBps: number;
  xrpReserve: string;
  checkedAt: Date;
  xrpDrops: string;
};

export class HermitTradingError extends Error {
  readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HermitTradingError";
  }
}

type AmmInfoResponse = {
  result?: {
    error?: string;
    amm?: {
      amount?: unknown;
      amount2?: {
        currency?: unknown;
        issuer?: unknown;
        value?: unknown;
      };
      trading_fee?: unknown;
    };
  };
};

type XamanCreateResponse = {
  uuid?: unknown;
  refs?: {
    qr_png?: unknown;
    websocket_status?: unknown;
  };
  next?: {
    always?: unknown;
  };
};

function parseXrpAmount(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new HermitTradingError("Enter an XRP amount with up to six decimal places.", 400);
  }
  const [whole = "0", fractional = ""] = value.split(".");
  const drops = BigInt(whole) * XRP_DROPS_PER_XRP + BigInt(fractional.padEnd(6, "0") || "0");
  const amount = Number(drops) / Number(XRP_DROPS_PER_XRP);
  if (!Number.isFinite(amount) || amount < MIN_XRP_AMOUNT || amount > MAX_XRP_AMOUNT) {
    throw new HermitTradingError("Buy between 0.01 and 1,000 XRP per order.", 400);
  }
  return { amount, drops: drops.toString() };
}

export function validateHermitXrpAmount(value: string) {
  return parseXrpAmount(value);
}

export function formatIssuedAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new HermitTradingError("The XRPL returned an invalid $HERMIT quote.", 503);
  }
  const precise = value.toPrecision(15).toLowerCase();
  const [mantissa = "", exponentPart] = precise.split("e");
  const exponent = exponentPart ? Number(exponentPart) : 0;
  const sign = mantissa.startsWith("-") ? "-" : "";
  const unsignedMantissa = sign ? mantissa.slice(1) : mantissa;
  const decimalIndex = unsignedMantissa.indexOf(".");
  const point = decimalIndex === -1 ? unsignedMantissa.length : decimalIndex;
  const digits = unsignedMantissa.replace(".", "");
  const shiftedPoint = point + exponent;

  let expanded: string;
  if (shiftedPoint <= 0) {
    expanded = `0.${"0".repeat(-shiftedPoint)}${digits}`;
  } else if (shiftedPoint >= digits.length) {
    expanded = `${digits}${"0".repeat(shiftedPoint - digits.length)}`;
  } else {
    expanded = `${digits.slice(0, shiftedPoint)}.${digits.slice(shiftedPoint)}`;
  }

  const [whole = "0", fraction = ""] = expanded.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return `${sign}${normalizedWhole}${normalizedFraction ? `.${normalizedFraction}` : ""}`;
}

export async function getHermitBuyQuote(
  xrpAmount: string,
  slippageBps: number,
): Promise<HermitBuyQuote> {
  const { amount, drops } = validateHermitXrpAmount(xrpAmount);
  if (!Number.isInteger(slippageBps) || slippageBps < 50 || slippageBps > 2_000) {
    throw new HermitTradingError("Choose slippage between 0.5% and 20%.", 400);
  }

  let response: Response;
  try {
    response = await fetch(XRPL_MAINNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "amm_info",
        params: [{
          asset: { currency: "XRP" },
          asset2: { currency: HERMIT_CURRENCY, issuer: HERMIT_ISSUER },
          ledger_index: "validated",
        }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HermitTradingError("The XRPL quote service is unavailable. Try again shortly.", 503);
  }
  if (!response.ok) {
    throw new HermitTradingError("The XRPL quote service is unavailable. Try again shortly.", 503);
  }

  const payload = await response.json() as AmmInfoResponse;
  const amm = payload.result?.amm;
  const xrpDrops = typeof amm?.amount === "string" ? Number(amm.amount) : NaN;
  const hermitReserve = Number(amm?.amount2?.value);
  const tradingFee = Number(amm?.trading_fee);
  if (
    payload.result?.error
    || !Number.isFinite(xrpDrops)
    || xrpDrops <= 0
    || !Number.isFinite(hermitReserve)
    || hermitReserve <= 0
    || !Number.isInteger(tradingFee)
    || tradingFee < 0
    || tradingFee > 1_000
    || amm?.amount2?.currency !== HERMIT_CURRENCY
    || amm?.amount2?.issuer !== HERMIT_ISSUER
  ) {
    throw new HermitTradingError("$HERMIT/XRP liquidity is not available on the XRPL AMM right now.", 503);
  }

  const xrpReserve = xrpDrops / Number(XRP_DROPS_PER_XRP);
  const feeRate = tradingFee / 100_000;
  const effectiveXrp = amount * (1 - feeRate);
  const expected = hermitReserve * effectiveXrp / (xrpReserve + effectiveXrp);
  const minimum = expected * (1 - slippageBps / 10_000);
  const spotRate = hermitReserve / xrpReserve;
  const impact = Math.max(0, Math.min(100, (1 - expected / (amount * spotRate)) * 100));

  return {
    xrpAmount,
    expectedHermit: formatIssuedAmount(expected),
    minimumHermit: formatIssuedAmount(minimum),
    priceImpactPercent: Number(impact.toFixed(4)),
    slippageBps,
    ammFeeBps: Math.round(tradingFee / 10),
    xrpReserve: formatIssuedAmount(xrpReserve),
    checkedAt: new Date(),
    xrpDrops: drops,
  };
}

export function buildHermitBuyTransaction(quote: HermitBuyQuote) {
  return {
    TransactionType: "OfferCreate",
    Flags: XRPL_OFFER_CREATE_IMMEDIATE_OR_CANCEL,
    TakerGets: quote.xrpDrops,
    TakerPays: {
      currency: HERMIT_CURRENCY,
      issuer: HERMIT_ISSUER,
      value: quote.minimumHermit,
    },
  };
}

export function buildHermitTrustlineTransaction() {
  return {
    TransactionType: "TrustSet",
    LimitAmount: {
      currency: HERMIT_CURRENCY,
      issuer: HERMIT_ISSUER,
      value: HERMIT_TRUSTLINE_LIMIT,
    },
  };
}

type DecimalParts = { coefficient: bigint; scale: number };

function parseDecimalParts(value: unknown): DecimalParts | null {
  if (typeof value !== "string" || value.length > 128) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] ?? "0");
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  const fraction = match[3] ?? "";
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function subtractDecimalStrings(left: unknown, right: unknown): string | null {
  const a = parseDecimalParts(left);
  const b = parseDecimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const difference = a.coefficient * 10n ** BigInt(scale - a.scale)
    - b.coefficient * 10n ** BigInt(scale - b.scale);
  const negative = difference < 0n;
  let digits = (negative ? -difference : difference).toString();
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  digits = digits.padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function isHermitCurrency(value: unknown) {
  return value === HERMIT_CURRENCY || value === "HERMIT";
}

export type HermitBuyLedgerOutcome =
  | { status: "completed"; receivedHermit: string }
  | { status: "unfilled" }
  | { status: "failed" };

/**
 * Resolve a Xaman-approved OfferCreate against validated XRPL metadata.
 * `null` means the ledger has not confirmed enough information yet.
 */
export async function getHermitBuyLedgerOutcome(
  txid: string,
  walletAddress: string,
): Promise<HermitBuyLedgerOutcome | null> {
  let response: Response;
  try {
    response = await fetch(XRPL_TX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "tx",
        params: [{ transaction: txid, binary: false }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const payload = await response.json() as {
    result?: {
      error?: string;
      validated?: boolean;
      hash?: unknown;
      tx_json?: Record<string, unknown>;
      meta?: {
        TransactionResult?: unknown;
        AffectedNodes?: unknown;
      };
    };
  };
  const result = payload.result;
  if (!result || result.error || result.validated !== true) return null;
  if (typeof result.hash === "string" && result.hash.toUpperCase() !== txid.toUpperCase()) return null;
  const transaction = result.tx_json ?? result as Record<string, unknown>;
  if (
    transaction.TransactionType !== "OfferCreate"
    || transaction.Account !== walletAddress
    || typeof transaction.TakerGets !== "string"
    || typeof transaction.TakerPays !== "object"
    || transaction.TakerPays === null
  ) return null;
  const takerPays = transaction.TakerPays as { currency?: unknown; issuer?: unknown };
  if (!isHermitCurrency(takerPays.currency) || takerPays.issuer !== HERMIT_ISSUER) return null;

  const metadata = result.meta;
  if (!metadata || typeof metadata.TransactionResult !== "string") return null;
  if (metadata.TransactionResult !== "tesSUCCESS") return { status: "failed" };
  if (!Array.isArray(metadata.AffectedNodes)) return null;

  let matchedTrustline = false;
  let received = "0";
  for (const affected of metadata.AffectedNodes) {
    if (typeof affected !== "object" || affected === null || !("ModifiedNode" in affected)) continue;
    const node = (affected as { ModifiedNode?: unknown }).ModifiedNode;
    if (typeof node !== "object" || node === null) continue;
    const modified = node as {
      LedgerEntryType?: unknown;
      FinalFields?: Record<string, unknown>;
      PreviousFields?: Record<string, unknown>;
    };
    if (modified.LedgerEntryType !== "RippleState") continue;
    const finalFields = modified.FinalFields;
    const previousFields = modified.PreviousFields;
    if (!finalFields || !previousFields) continue;
    const lowLimit = finalFields.LowLimit as { currency?: unknown; issuer?: unknown } | undefined;
    const highLimit = finalFields.HighLimit as { currency?: unknown; issuer?: unknown } | undefined;
    const isWalletLow = lowLimit?.issuer === walletAddress && highLimit?.issuer === HERMIT_ISSUER;
    const isWalletHigh = highLimit?.issuer === walletAddress && lowLimit?.issuer === HERMIT_ISSUER;
    if (
      (!isWalletLow && !isWalletHigh)
      || !isHermitCurrency(lowLimit?.currency)
      || !isHermitCurrency(highLimit?.currency)
    ) continue;

    matchedTrustline = true;
    const balanceDelta = isWalletLow
      ? subtractDecimalStrings(
        (finalFields.Balance as { value?: unknown } | undefined)?.value,
        (previousFields.Balance as { value?: unknown } | undefined)?.value,
      )
      : subtractDecimalStrings(
        (previousFields.Balance as { value?: unknown } | undefined)?.value,
        (finalFields.Balance as { value?: unknown } | undefined)?.value,
      );
    if (balanceDelta === null) return null;
    if (balanceDelta.startsWith("-")) continue;
    const total = subtractDecimalStrings(received, `-${balanceDelta}`);
    if (total === null) return null;
    received = total;
  }

  if (!matchedTrustline) return null;
  const receivedParts = parseDecimalParts(received);
  if (!receivedParts || receivedParts.coefficient <= 0n) return { status: "unfilled" };
  return { status: "completed", receivedHermit: received };
}

export async function createHermitXamanPayload(
  transactionType: "buy" | "trustline",
  walletAddress: string,
  txjson: Record<string, unknown>,
  quote: HermitBuyQuote | null,
) {
  const apiKey = process.env.XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new HermitTradingError("Xaman trading is not configured for this environment.", 503);
  }

  const instruction = transactionType === "buy"
    ? `Buy up to ${quote?.xrpAmount} XRP worth of $HERMIT on XRPL Mainnet. Minimum receive: ${quote?.minimumHermit} $HERMIT. Only approve if Xaman shows wallet ${walletAddress}.`
    : `Create a $HERMIT trustline to issuer ${HERMIT_ISSUER} with a limit of ${HERMIT_TRUSTLINE_LIMIT}. XRPL reserve and network fee apply. Only approve if Xaman shows wallet ${walletAddress}.`;
  const identifier = `frogtown:hermit:${transactionType}:${walletAddress}:${randomUUID()}`;

  let response: Response;
  try {
    response = await fetch(XAMAN_PAYLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
      },
      body: JSON.stringify({
        txjson,
        options: {
          submit: true,
          expire: 5,
          force_network: "MAINNET",
        },
        custom_meta: {
          identifier,
          instruction,
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HermitTradingError("Xaman could not be reached. Try again.", 502);
  }
  if (!response.ok) {
    throw new HermitTradingError("Xaman could not prepare this transaction. Check your wallet and try again.", 502);
  }

  const payload = await response.json() as XamanCreateResponse;
  const payloadId = typeof payload.uuid === "string" ? payload.uuid : null;
  const qrUrl = typeof payload.refs?.qr_png === "string" ? payload.refs.qr_png : null;
  const websocketStatusUrl = typeof payload.refs?.websocket_status === "string"
    ? payload.refs.websocket_status
    : null;
  const deeplink = typeof payload.next?.always === "string" ? payload.next.always : null;
  if (!payloadId || !qrUrl || !websocketStatusUrl || !deeplink) {
    throw new HermitTradingError("Xaman returned an incomplete sign request. No transaction was submitted.", 502);
  }

  return {
    payloadId,
    qrUrl,
    websocketStatusUrl,
    deeplink,
    transactionType,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    quote: quote
      ? {
          xrpAmount: quote.xrpAmount,
          expectedHermit: quote.expectedHermit,
          minimumHermit: quote.minimumHermit,
          priceImpactPercent: quote.priceImpactPercent,
          slippageBps: quote.slippageBps,
          ammFeeBps: quote.ammFeeBps,
          xrpReserve: quote.xrpReserve,
          checkedAt: quote.checkedAt,
        }
      : null,
  };
}
