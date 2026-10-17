import { useGetHermitMarketData, getGetHermitMarketDataQueryKey } from '@workspace/api-client-react';
import { CircleAlert, TrendingUp } from 'lucide-react';

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumSignificantDigits: 2,
    maximumSignificantDigits: 3,
  }).format(value);
}

function formatMarketCap(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function HermitMarketTicker() {
  const marketQuery = useGetHermitMarketData({
    query: {
      queryKey: getGetHermitMarketDataQueryKey(),
      refetchInterval: 60_000,
      staleTime: 45_000,
      retry: 1,
    },
  });
  const market = marketQuery.data;

  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-2.5 py-1.5 sm:gap-3 sm:px-3"
      title={market ? `Market data from ${market.source}; updated ${new Date(market.updatedAt).toLocaleTimeString()}. Thin-liquidity prices can move sharply.` : 'Live $HERMIT price and market capitalization'}
      aria-label={market
        ? `$HERMIT price ${formatPrice(market.priceUsd)}, market capitalization ${formatMarketCap(market.marketCapUsd)}`
        : 'Loading $HERMIT market data'}
      data-testid="hermit-market-ticker"
    >
      <TrendingUp className={`hidden size-4 shrink-0 sm:block ${market?.isStale ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--primary))]'}`} aria-hidden="true" />
      {market ? (
        <>
          <div className="min-w-0">
            <p className="mono text-[8px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">HERMIT price</p>
            <p className="mono text-[10px] font-semibold tabular-nums sm:text-[11px]" data-testid="text-hermit-price">{formatPrice(market.priceUsd)}</p>
          </div>
          <span className="h-7 w-px bg-[hsl(var(--border))]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="mono text-[8px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Market cap</p>
            <p className="mono text-[10px] font-semibold tabular-nums sm:text-[11px]" data-testid="text-hermit-market-cap">{formatMarketCap(market.marketCapUsd)}</p>
          </div>
          {market.isStale && <span className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--accent))]" aria-label="Showing cached market data" />}
        </>
      ) : marketQuery.isError ? (
        <p className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]" role="status" data-testid="status-hermit-market-unavailable">
          <CircleAlert className="size-3.5 shrink-0" /> Market data unavailable
        </p>
      ) : (
        <p className="mono text-[9px] text-[hsl(var(--muted-foreground))]" role="status">Loading $HERMIT…</p>
      )}
    </div>
  );
}
