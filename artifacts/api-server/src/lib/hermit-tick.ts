export type HermitTick = "green" | "gold" | null;

export type HermitTickCheck = {
  tick: HermitTick;
  checkStatus: "checked" | "unavailable";
  checkedAt: Date;
};

export function hermitTickCacheControl(
  checkStatus: HermitTickCheck["checkStatus"],
  forceRefresh: boolean,
): string {
  return checkStatus === "checked" && !forceRefresh
    ? "public, max-age=0, s-maxage=30, stale-while-revalidate=15"
    : "no-store";
}

const HERMIT_ISSUER = "r95w8bhxwgLTNC8V2j3Fv9yPuwaQfMjYL3";
const HERMIT_CURRENCY = "4845524D49540000000000000000000000000000";
const XRPL_MAINNET_RPC = "https://s1.ripple.com:51234/";
const LOOKUP_CACHE_TTL_MS = 30_000;
const MAX_CACHED_WALLETS = 2_000;
const MAX_ACTIVE_LOOKUPS = 8;
const MAX_ACTIVE_PUBLIC_LOOKUPS = 6;
const MAX_ACTIVE_REFRESH_LOOKUPS = 2;
const MAX_QUEUED_PUBLIC_LOOKUPS = 64;
const MAX_QUEUED_REFRESH_LOOKUPS = 24;
const MAX_QUEUE_WAIT_MS = 3_000;

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
const pendingPublicChecks = new Map<string, Promise<HermitTickCheck>>();
const pendingRefreshChecks = new Map<string, Promise<HermitTickCheck>>();

type LookupPriority = "public" | "refresh";
type LookupWaiter = {
  priority: LookupPriority;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const publicLookupQueue: LookupWaiter[] = [];
const refreshLookupQueue: LookupWaiter[] = [];
let activeLookups = 0;
let activePublicLookups = 0;
let activeRefreshLookups = 0;

function hasLookupCapacity(priority: LookupPriority) {
  return activeLookups < MAX_ACTIVE_LOOKUPS
    && (priority === "refresh"
      ? activeRefreshLookups < MAX_ACTIVE_REFRESH_LOOKUPS
      : activePublicLookups < MAX_ACTIVE_PUBLIC_LOOKUPS);
}

function reserveLookupSlot(priority: LookupPriority) {
  activeLookups += 1;
  if (priority === "refresh") activeRefreshLookups += 1;
  else activePublicLookups += 1;
}

function releaseLookupSlot(priority: LookupPriority) {
  activeLookups -= 1;
  if (priority === "refresh") activeRefreshLookups -= 1;
  else activePublicLookups -= 1;
  drainLookupQueues();
}

function createSlotRelease(priority: LookupPriority) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseLookupSlot(priority);
  };
}

function startQueuedLookup(waiter: LookupWaiter) {
  clearTimeout(waiter.timer);
  reserveLookupSlot(waiter.priority);
  waiter.resolve(createSlotRelease(waiter.priority));
}

function drainLookupQueues() {
  while (true) {
    const refreshWaiter = refreshLookupQueue[0];
    if (refreshWaiter && hasLookupCapacity("refresh")) {
      refreshLookupQueue.shift();
      startQueuedLookup(refreshWaiter);
      continue;
    }

    const publicWaiter = publicLookupQueue[0];
    if (publicWaiter && hasLookupCapacity("public")) {
      publicLookupQueue.shift();
      startQueuedLookup(publicWaiter);
      continue;
    }
    return;
  }
}

function acquireLookupSlot(priority: LookupPriority): Promise<() => void> {
  if (hasLookupCapacity(priority)) {
    reserveLookupSlot(priority);
    return Promise.resolve(createSlotRelease(priority));
  }

  const queue = priority === "refresh" ? refreshLookupQueue : publicLookupQueue;
  const queueLimit = priority === "refresh"
    ? MAX_QUEUED_REFRESH_LOOKUPS
    : MAX_QUEUED_PUBLIC_LOOKUPS;
  if (queue.length >= queueLimit) {
    return Promise.reject(new Error("XRPL lookup queue is full."));
  }

  return new Promise((resolve, reject) => {
    let waiter: LookupWaiter;
    const timer = setTimeout(() => {
      const index = queue.indexOf(waiter);
      if (index === -1) return;
      queue.splice(index, 1);
      reject(new Error("XRPL lookup queue wait timed out."));
    }, MAX_QUEUE_WAIT_MS);
    waiter = { priority, resolve, reject, timer };
    queue.push(waiter);
  });
}

async function withLookupSlot<T>(
  priority: LookupPriority,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireLookupSlot(priority);
  try {
    return await operation();
  } finally {
    release();
  }
}

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
  if (forceRefresh) {
    const pendingRefresh = pendingRefreshChecks.get(walletAddress);
    if (pendingRefresh) return pendingRefresh;
    return startWalletCheck(walletAddress, "refresh");
  }

  const cached = cachedChecks.get(walletAddress);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cachedChecks.delete(walletAddress);

  const pendingRefresh = pendingRefreshChecks.get(walletAddress);
  if (pendingRefresh) return pendingRefresh;
  const pendingPublic = pendingPublicChecks.get(walletAddress);
  if (pendingPublic) return pendingPublic;
  return startWalletCheck(walletAddress, "public");
}

function startWalletCheck(
  walletAddress: string,
  priority: LookupPriority,
): Promise<HermitTickCheck> {
  const registry = priority === "refresh" ? pendingRefreshChecks : pendingPublicChecks;
  let check: Promise<HermitTickCheck>;
  check = withLookupSlot(priority, () => requestHermitTick(walletAddress))
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
      if (registry.get(walletAddress) === check) registry.delete(walletAddress);
    });
  registry.set(walletAddress, check);
  return check;
}
