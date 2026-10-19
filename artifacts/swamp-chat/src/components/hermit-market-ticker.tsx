import {
  useGetHermitMarketData,
  getGetHermitMarketDataQueryKey,
  useGetWalletHermitBalance,
} from '@workspace/api-client-react';
import { CircleAlert, TrendingUp } from 'lucide-react';
import { hermitBalanceQueryKey } from '@/lib/hermit-balance-query-key';

function formatMarketCap(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function HermitMarketTicker({ walletAddress }: { walletAddress?: string }) {
  const marketQuery = useGetHermitMarketData({
    query: {
      queryKey: getGetHermitMarketDataQueryKey(),
      refetchInterval: 60_000,
      staleTime: 45_000,
      retry: 1,
    },
  });
  const market = marketQuery.data;

  // Keep the fresh signed-in wallet scan without adding balance or purchase controls to the ticker.
  useGetWalletHermitBalance(
    { refresh: true },
    {
      query: {
        enabled: Boolean(walletAddress),
        queryKey: hermitBalanceQueryKey(walletAddress ?? 'signed-out', true),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
      request: { credentials: 'same-origin' },
    },
  );

  return (
    <div
      className="flex min-w-0 items-center gap-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-1 py-1.5 sm:gap-2 sm:px-2.5"
      title={market ? `Market capitalization from ${market.source}; updated ${new Date(market.updatedAt).toLocaleTimeString()}.` : 'Live $HERMIT market capitalization'}
      aria-label={market
        ? `$HERMIT market capitalization ${formatMarketCap(market.marketCapUsd)}`
        : 'Loading $HERMIT market data'}
      data-testid="hermit-market-ticker"
    >
      <TrendingUp className={`hidden size-4 shrink-0 sm:block ${market?.isStale ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--primary))]'}`} aria-hidden="true" />
      {market ? (
        <>
          <div className="shrink-0 rounded-lg bg-[hsl(var(--primary)/.09)] px-2 py-1 ring-1 ring-inset ring-[hsl(var(--primary)/.15)] sm:px-2.5">
            <p className="mono text-[8px] font-semibold uppercase tracking-[.13em] text-[hsl(var(--primary))]">Market cap</p>
            <p className="mono text-[12px] font-bold leading-4 tabular-nums text-[hsl(var(--primary))] sm:text-sm" data-testid="text-hermit-market-cap">{formatMarketCap(market.marketCapUsd)}</p>
          </div>
          {market.isStale && <span className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--accent))]" aria-label="Showing cached market data" />}
        </>
      ) : marketQuery.isError ? (
        <p className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]" role="status" data-testid="status-hermit-market-unavailable">
          <CircleAlert className="size-3.5 shrink-0" /> Market data unavailable
        </p>
      ) : (
        <p className="mono text-[9px] text-[hsl(var(--muted-foreground))]" role="status">Loading market cap…</p>
      )}
    </div>
  );
}
