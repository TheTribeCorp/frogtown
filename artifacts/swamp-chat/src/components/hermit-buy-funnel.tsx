import { useState } from 'react';
import { useGetHermitBuyFunnel } from '@workspace/api-client-react';
import { ChartNoAxesColumn, LoaderCircle, RotateCw } from 'lucide-react';

const EVENT_LABELS: Record<string, string> = {
  quote_preview: 'Quote previewed',
  trustline_approval: 'Trustline request opened',
  trustline_rejected: 'Trustline declined',
  trustline_expired: 'Trustline request expired',
  trustline_wallet_mismatch: 'Trustline wallet mismatch',
  buy_approval: 'Buy request opened',
  buy_completed: 'Buy completed',
  buy_unfilled: 'Buy had no fill',
  buy_failed: 'Buy failed on ledger',
  buy_rejected: 'Buy declined',
  buy_expired: 'Buy request expired',
  buy_wallet_mismatch: 'Buy wallet mismatch',
};

export function HermitBuyFunnelPanel() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const funnel = useGetHermitBuyFunnel(
    { days },
    {
      query: {
        staleTime: 60_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
      request: { credentials: 'same-origin' },
    },
  );

  return (
    <section
      className="mb-6 overflow-hidden rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.88)]"
      aria-label="$HERMIT purchase funnel"
      data-testid="panel-hermit-buy-funnel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
            <ChartNoAxesColumn className="size-4" />
          </span>
          <div>
            <p className="mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--secondary))]">aggregate only</p>
            <h2 className="text-sm font-semibold">Purchase flow</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="hermit-funnel-days" className="sr-only">Reporting period</label>
          <select
            id="hermit-funnel-days"
            value={days}
            onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90)}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-xs"
            data-testid="select-hermit-funnel-days"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            type="button"
            onClick={() => void funnel.refetch()}
            disabled={funnel.isFetching}
            aria-label="Refresh purchase flow"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            data-testid="button-refresh-hermit-funnel"
          >
            <RotateCw className={`size-3.5 ${funnel.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <p className="px-4 pt-3 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">
        Step counts are grouped by day and event only. No wallet addresses, transaction details, or message text are stored or shown.
      </p>
      {funnel.isError ? (
        <div className="flex items-center justify-between gap-3 px-4 py-4 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid="error-hermit-funnel">
          <span>Purchase-flow totals could not be loaded.</span>
          <button type="button" onClick={() => void funnel.refetch()} className="font-medium underline">Retry</button>
        </div>
      ) : funnel.isLoading ? (
        <div className="flex items-center gap-2 px-4 py-5 text-xs text-[hsl(var(--muted-foreground))]" role="status">
          <LoaderCircle className="size-3.5 animate-spin" /> Loading aggregate counts…
        </div>
      ) : (
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="list-hermit-funnel-counts">
          {funnel.data?.totals.map((item) => (
            <div key={item.event} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] px-3 py-2">
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{EVENT_LABELS[item.event] ?? 'Purchase step'}</span>
              <span className="mono text-sm font-semibold tabular-nums">{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
