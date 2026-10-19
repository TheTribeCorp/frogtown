import { useState } from 'react';
import {
  useGetHermitMarketData,
  getGetHermitMarketDataQueryKey,
  useGetWalletHermitBalance,
} from '@workspace/api-client-react';
import { Check, CircleAlert, Copy, RefreshCw, TrendingUp } from 'lucide-react';
import { hermitBalanceQueryKey } from '@/lib/hermit-balance-query-key';

const HERMIT_ISSUER = 'r95w8bhxwgLTNC8V2j3Fv9yPuwaQfMjYL3';

function formatMarketCap(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatBalance(value: string | null | undefined) {
  if (value == null) return 'Unavailable';
  const [whole = '0', fraction = ''] = value.split('.');
  let groupedWhole = whole;
  try {
    groupedWhole = BigInt(whole).toLocaleString('en-US');
  } catch {
    // Preserve the XRPL decimal string if an unexpected value is returned.
  }
  return `${groupedWhole}${fraction ? `.${fraction}` : ''}`;
}

export function HermitMarketTicker({ walletAddress }: { walletAddress?: string }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const marketQuery = useGetHermitMarketData({
    query: {
      queryKey: getGetHermitMarketDataQueryKey(),
      refetchInterval: 60_000,
      staleTime: 45_000,
      retry: 1,
    },
  });
  const market = marketQuery.data;
  const balanceQuery = useGetWalletHermitBalance(
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
  const balance = balanceQuery.data;

  const copyIssuerAddress = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(HERMIT_ISSUER);
      } else {
        const copyField = document.createElement('textarea');
        copyField.value = HERMIT_ISSUER;
        copyField.setAttribute('readonly', '');
        copyField.style.position = 'fixed';
        copyField.style.opacity = '0';
        document.body.appendChild(copyField);
        copyField.select();
        const copied = document.execCommand('copy');
        copyField.remove();
        if (!copied) throw new Error('Clipboard copy was not available.');
      }
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
    window.setTimeout(() => setCopyStatus('idle'), 2_000);
  };

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
      {walletAddress && (
        <>
          <span className="h-7 w-px shrink-0 bg-[hsl(var(--border))]" aria-hidden="true" />
          <div className="min-w-0 max-w-[4.5rem] shrink sm:max-w-32">
            <p className="mono text-[7px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))] sm:text-[8px] sm:tracking-[.14em]">My $HERMIT</p>
            <p
              className="mono truncate text-[9px] font-semibold tabular-nums sm:text-[10px]"
              data-testid="text-nav-hermit-balance"
              title={balance?.checkStatus === 'checked'
                ? `${balance.balance ?? '0'} $HERMIT, checked against XRPL${balanceQuery.isFetching ? ' (refreshing)' : ''}`
                : balanceQuery.isFetching
                  ? 'Checking your $HERMIT holding against XRPL'
                  : 'Your $HERMIT holding is unavailable. Tap refresh to try again.'}
            >
              {balance?.checkStatus === 'checked'
                ? formatBalance(balance.balance)
                : balanceQuery.isFetching
                  ? 'Checking…'
                  : 'Unavailable'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void balanceQuery.refetch()}
            disabled={balanceQuery.isFetching}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
            aria-label="Rescan my $HERMIT balance on XRPL"
            title="Rescan my $HERMIT balance on XRPL"
            data-testid="button-refresh-nav-hermit-balance"
          >
            <RefreshCw className={`size-3 ${balanceQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => void copyIssuerAddress()}
        className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border))] px-1.5 text-[9px] font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] sm:px-2"
        aria-label={`Copy $HERMIT contract address ${HERMIT_ISSUER}`}
        title={`Copy $HERMIT contract address: ${HERMIT_ISSUER}`}
        data-testid="button-copy-hermit-issuer"
      >
        {copyStatus === 'copied'
          ? <Check className="size-3.5 text-[hsl(var(--primary))]" aria-hidden="true" />
          : copyStatus === 'failed'
            ? <CircleAlert className="size-3.5 text-[hsl(var(--destructive))]" aria-hidden="true" />
            : <Copy className="size-3.5" aria-hidden="true" />}
        <span>
          {copyStatus === 'copied'
            ? 'Copied'
            : copyStatus === 'failed'
              ? 'Retry'
              : 'Copy CA'}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copyStatus === 'copied'
          ? 'The $HERMIT contract address was copied.'
          : copyStatus === 'failed'
            ? `Copy failed. $HERMIT contract address: ${HERMIT_ISSUER}`
            : ''}
      </span>
    </div>
  );
}
