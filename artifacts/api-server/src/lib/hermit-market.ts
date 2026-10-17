const HERMIT_TOKEN_ID =
  "4845524D49540000000000000000000000000000.r95w8bhxwgLTNC8V2j3Fv9yPuwaQfMjYL3";
const GECKOTERMINAL_URL =
  `https://api.geckoterminal.com/api/v2/networks/xrpl/tokens/${encodeURIComponent(HERMIT_TOKEN_ID)}/pools?page=1`;
const CACHE_TTL_MS = 60_000;
const STALE_IF_ERROR_MS = 10 * 60_000;

export type HermitMarketData = {
  priceUsd: number;
  marketCapUsd: number | null;
  updatedAt: string;
  isStale: boolean;
  source: "GeckoTerminal";
};

type CachedMarketData = { data: HermitMarketData; fetchedAt: number };
let cachedMarketData: CachedMarketData | null = null;
let pendingRequest: Promise<HermitMarketData> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseGeckoTerminalMarketData(payload: unknown, now = new Date()): HermitMarketData {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("GeckoTerminal returned an invalid market-data response.");
  }

  const pools = payload.data.flatMap((pool) => {
    if (!isRecord(pool) || !isRecord(pool.attributes)) return [];
    const attributes = pool.attributes;
    const priceUsd = positiveNumber(attributes.token_price_usd)
      ?? positiveNumber(attributes.base_token_price_usd);
    if (priceUsd === null) return [];
    const marketCapUsd = positiveNumber(attributes.market_cap_usd);
    const reserveUsd = positiveNumber(attributes.reserve_in_usd) ?? 0;
    return [{ priceUsd, marketCapUsd, reserveUsd }];
  });

  pools.sort((left, right) => right.reserveUsd - left.reserveUsd);
  const primaryPool = pools[0];
  if (!primaryPool) {
    throw new Error("GeckoTerminal has no priced $HERMIT pool to display.");
  }

  return {
    priceUsd: primaryPool.priceUsd,
    marketCapUsd: primaryPool.marketCapUsd,
    updatedAt: now.toISOString(),
    isStale: false,
    source: "GeckoTerminal",
  };
}

export async function getHermitMarketData(): Promise<HermitMarketData> {
  const now = Date.now();
  if (cachedMarketData && now - cachedMarketData.fetchedAt < CACHE_TTL_MS) {
    return cachedMarketData.data;
  }
  if (pendingRequest) return pendingRequest;

  pendingRequest = (async () => {
    try {
      const response = await fetch(GECKOTERMINAL_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`GeckoTerminal returned HTTP ${response.status}.`);
      }
      const data = parseGeckoTerminalMarketData(await response.json());
      cachedMarketData = { data, fetchedAt: Date.now() };
      return data;
    } catch (error) {
      if (cachedMarketData && Date.now() - cachedMarketData.fetchedAt < STALE_IF_ERROR_MS) {
        return { ...cachedMarketData.data, isStale: true };
      }
      throw error;
    } finally {
      pendingRequest = null;
    }
  })();
  return pendingRequest;
}
