export type HermitTick = "green" | "gold" | null;

export type HermitTickCheck = {
  tick: HermitTick;
  checkStatus: "checked" | "unavailable";
  checkedAt: Date;
};

const HERMIT_ISSUER = "r95w8bhxwgLTNC8V2j3Fv9yPuwaQfMjYL3";
const HERMIT_CURRENCY = "4845524D49540000000000000000000000000000";
const XRPL_MAINNET_RPC = "https://s1.ripple.com:51234/";
const LOOKUP_CACHE_TTL_MS = 30_000;
const MAX_CACHED_WALLETS = 2_000;

type XrplLine = {
  account?: unknown;
  balance?: unknown;
  currency?: unknown;
};

type XrplAccountLinesResponse = {
  result?: {
    error?: unknown;
    lines?: unknown;
  };
};

const cachedChecks = new Map<string, { value: HermitTickCheck; expiresAt: number }>();
const pendingChecks = new Map<string, Promise<HermitTickCheck>>();

export function tickForHermitBalance(balance: string): HermitTick {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(balance);
  if (!match) throw new Error("XRPL returned an invalid issued-token balance.");

  const [, sign, integerPart, fractionalPart = ""] = match;
  if (sign === "-") return null;

  const wholeTokens = BigInt(integerPart);
  const hasFraction = /[1-9]/.test(fractionalPart);
  if (wholeTokens === 0n && !hasFraction) return null;
  return wholeTokens >= 20_000_000n ? "gold" : "green";
}

export function tickForIssuerBalance(balance: string): HermitTick {
  if (!/^-?\d+(?:\.\d+)?$/.test(balance)) {
    throw new Error("XRPL returned an invalid issued-token balance.");
  }
  return balance.startsWith("-") ? tickForHermitBalance(balance.slice(1)) : null;
}

function rememberCheck(walletAddress: string, value: HermitTickCheck) {
  cachedChecks.delete(walletAddress);
  while (cachedChecks.size >= MAX_CACHED_WALLETS) {
    const oldest = cachedChecks.keys().next().value;
    if (oldest === undefined) break;
    cachedChecks.delete(oldest);
  }
  cachedChecks.set(walletAddress, {
    value,
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
  });
}

async function requestHermitTick(walletAddress: string): Promise<HermitTickCheck> {
  const response = await fetch(XRPL_MAINNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "account_lines",
      params: [{
        // Query from the issuer side. Some Clio nodes return an empty first
        // page when `peer` is used against a holder with many trustlines.
        account: HERMIT_ISSUER,
        peer: walletAddress,
        ledger_index: "validated",
        limit: 1,
      }],
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) throw new Error(`XRPL lookup failed with status ${response.status}.`);
  const payload = await response.json() as XrplAccountLinesResponse;
  const result = payload.result;
  if (!result) throw new Error("XRPL returned an invalid account-lines response.");

  if (result.error === "actNotFound") {
    return { tick: null, checkStatus: "checked", checkedAt: new Date() };
  }
  if (result.error) throw new Error("XRPL could not verify the wallet trustline.");

  if (!Array.isArray(result.lines)) {
    throw new Error("XRPL returned an invalid trustline list.");
  }
  const hermitLine = (result.lines as XrplLine[]).find(
    (line) => line.account === walletAddress && line.currency === HERMIT_CURRENCY,
  );
  if (!hermitLine) {
    return { tick: null, checkStatus: "checked", checkedAt: new Date() };
  }
  if (typeof hermitLine.balance !== "string") {
    throw new Error("XRPL returned an invalid $HERMIT balance.");
  }

  return {
    // The trustline balance is from the issuer's perspective; a negative
    // value is the holder's positive $HERMIT balance.
    tick: tickForIssuerBalance(hermitLine.balance),
    checkStatus: "checked",
    checkedAt: new Date(),
  };
}

export async function getWalletHermitTick(
  walletAddress: string,
  forceRefresh = false,
): Promise<HermitTickCheck> {
  if (!forceRefresh) {
    const cached = cachedChecks.get(walletAddress);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) cachedChecks.delete(walletAddress);

    const pending = pendingChecks.get(walletAddress);
    if (pending) return pending;
  }

  const check = requestHermitTick(walletAddress)
    .then((value) => {
      rememberCheck(walletAddress, value);
      return value;
    })
    .catch((): HermitTickCheck => ({
      tick: null,
      checkStatus: "unavailable",
      checkedAt: new Date(),
    }))
    .finally(() => {
      if (pendingChecks.get(walletAddress) === check) pendingChecks.delete(walletAddress);
    });

  if (!forceRefresh) pendingChecks.set(walletAddress, check);
  return check;
}
