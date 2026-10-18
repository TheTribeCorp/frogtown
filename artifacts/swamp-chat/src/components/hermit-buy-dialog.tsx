import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getWalletHermitBalance,
  useCreateHermitBuyFunnelEvent,
  useCreateHermitBuyPayload,
  useCreateHermitTrustlinePayload,
  useGetHermitBuyQuote,
  getGetHermitBuyQuoteQueryKey,
  useGetHermitTradeStatus,
  useGetWalletHermitBalance,
  type HermitBuyFunnelEventInputEvent,
  type HermitTradePayload,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, CircleAlert, LoaderCircle, RotateCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { hermitBalanceQueryKey } from '@/lib/hermit-balance-query-key';

type HermitBuyDialogProps = {
  walletAddress: string;
  onBalanceUpdate?: (balance: string | null, trustlineExists: boolean | null) => void;
};

const XRP_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const SLIPPAGE_OPTIONS = [
  { value: 50, label: '0.5%' },
  { value: 100, label: '1%' },
  { value: 300, label: '3%' },
  { value: 500, label: '5%' },
  { value: 1_000, label: '10%' },
  { value: 2_000, label: '20%' },
];

function formatHermit(value: string | null | undefined) {
  if (value == null) return 'Unavailable';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(amount)
    : value;
}

function formatXrp(value: string | null | undefined) {
  if (value == null) return 'Unavailable';
  const [whole = '0', fraction = ''] = value.split('.');
  let groupedWhole = whole;
  try {
    groupedWhole = BigInt(whole).toLocaleString('en-US');
  } catch {
    // Keep the XRPL amount intact if the value is unexpectedly formatted.
  }
  return `${groupedWhole}${fraction ? `.${fraction}` : ''}`;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function formatExactHermit(value: string) {
  const [whole = '0', fraction = ''] = value.split('.');
  let groupedWhole = whole;
  try {
    groupedWhole = BigInt(whole).toLocaleString('en-US');
  } catch {
    // The API returns a decimal string; keep it intact if an unexpected format arrives.
  }
  return `${groupedWhole}${fraction ? `.${fraction}` : ''}`;
}

function statusCopy(status: string, transactionType: HermitTradePayload['transactionType'] | undefined) {
  switch (status) {
    case 'signed':
      return transactionType === 'trustline'
        ? 'Xaman signed the trustline request. Refresh the balance to confirm it on XRPL.'
        : 'Xaman signed the order. Frogtown is waiting for the XRPL ledger to confirm what, if anything, was delivered.';
    case 'completed':
      return 'The XRPL ledger confirmed this buy.';
    case 'unfilled':
      return 'The order was validated, but no $HERMIT was delivered. Any unfilled XRP was not left as an open offer.';
    case 'failed':
      return 'The XRPL ledger did not complete this order. Check your wallet activity for the network fee.';
    case 'rejected':
      return 'The transaction was not approved in Xaman.';
    case 'expired':
      return 'This Xaman request expired. Prepare a new one if you still want to continue.';
    case 'wallet_mismatch':
      return 'Xaman did not confirm the Frogtown wallet as the signer. Check the address shown in Xaman before trying again.';
    default:
      return 'Waiting for you to review and approve the request in Xaman.';
  }
}

export function HermitBuyDialog({ walletAddress, onBalanceUpdate }: HermitBuyDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [xrpAmount, setXrpAmount] = useState('1');
  const [slippageBps, setSlippageBps] = useState(500);
  const [activePayload, setActivePayload] = useState<HermitTradePayload | null>(null);
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);
  const [balanceNotice, setBalanceNotice] = useState('');
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const handledStatusesRef = useRef(new Set<string>());
  const lastQuoteEventRef = useRef<string | null>(null);
  const funnelEventMutation = useCreateHermitBuyFunnelEvent({
    request: { credentials: 'same-origin' },
  });
  const trackFunnelEvent = useCallback((event: HermitBuyFunnelEventInputEvent) => {
    funnelEventMutation.mutate({ data: { event } }, { onError: () => undefined });
  }, [funnelEventMutation.mutate]);

  const balanceKey = hermitBalanceQueryKey(walletAddress, false);
  const balanceQuery = useGetWalletHermitBalance(
    { refresh: false },
    {
      query: {
        enabled: open,
        queryKey: balanceKey,
        staleTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
      },
      request: { credentials: 'same-origin' },
    },
  );
  const currentBalance = balanceQuery.data;
  const statusQuery = useGetHermitTradeStatus(
    activePayload?.payloadId ?? '',
    {
      query: {
        enabled: Boolean(activePayload),
        retry: false,
        refetchOnWindowFocus: false,
        refetchInterval: activePayload?.transactionType === 'buy' && tradeStatus === 'signed' ? 4_000 : false,
      },
      request: { credentials: 'same-origin' },
    },
  );

  const amountIsValid = XRP_AMOUNT_PATTERN.test(xrpAmount)
    && Number(xrpAmount) >= 0.01
    && Number(xrpAmount) <= 1_000;
  const quoteParams = useMemo(() => ({ xrpAmount, slippageBps }), [xrpAmount, slippageBps]);
  const quoteQuery = useGetHermitBuyQuote(quoteParams, {
    query: {
      enabled: open && currentBalance?.checkStatus === 'checked' && currentBalance.trustlineExists === true && amountIsValid,
      queryKey: getGetHermitBuyQuoteQueryKey(quoteParams),
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
    },
    request: { credentials: 'same-origin' },
  });
  const quote = quoteQuery.data;
  const trustlineMutation = useCreateHermitTrustlinePayload({
    mutation: {
      onSuccess: (payload) => {
        setActivePayload(payload);
        setTradeStatus(null);
        setBalanceNotice('');
        trackFunnelEvent('trustline_approval');
      },
    },
  });
  const buyMutation = useCreateHermitBuyPayload({
    mutation: {
      onSuccess: (payload) => {
        setActivePayload(payload);
        setTradeStatus(null);
        setBalanceNotice('');
        trackFunnelEvent('buy_approval');
      },
    },
  });

  const refreshBalance = useCallback(async () => {
    setRefreshingBalance(true);
    setBalanceNotice('');
    try {
      const balance = await getWalletHermitBalance(
        { refresh: true },
        { credentials: 'same-origin' },
      );
      queryClient.setQueryData(balanceKey, balance);
      queryClient.setQueryData(hermitBalanceQueryKey(walletAddress, true), balance);
      onBalanceUpdate?.(balance.balance, balance.trustlineExists);
      setBalanceNotice(
        balance.checkStatus === 'checked'
          ? 'Balance checked against XRPL.'
          : 'XRPL could not confirm the balance. Try again shortly.',
      );
    } catch {
      setBalanceNotice('Could not refresh the balance. Try again shortly.');
    } finally {
      setRefreshingBalance(false);
    }
  }, [balanceKey, onBalanceUpdate, queryClient, walletAddress]);

  useEffect(() => {
    const websocketUrl = activePayload?.websocketStatusUrl;
    if (!websocketUrl) return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(websocketUrl);
    } catch {
      return;
    }
    if (parsedUrl.protocol !== 'wss:' || !['xumm.app', 'xaman.app'].includes(parsedUrl.hostname)) {
      return;
    }

    const socket = new WebSocket(websocketUrl);
    socket.onmessage = (event) => {
      let message: { signed?: unknown; payload_uuidv4?: unknown; expired?: unknown };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (
        message.expired === true
        || (typeof message.signed === 'boolean' && message.payload_uuidv4 === activePayload.payloadId)
      ) {
        socket.close();
        void statusQuery.refetch().then((result) => {
          const status = result.data?.status;
          if (status && status !== 'pending') setTradeStatus(status);
        });
      }
    };
    socket.onerror = () => {
      setBalanceNotice('Live Xaman updates are unavailable. Use “Check Xaman status” after approving.');
    };
    return () => socket.close();
  }, [activePayload?.payloadId, activePayload?.websocketStatusUrl, statusQuery.refetch]);

  useEffect(() => {
    if (!open || !quote) return;
    const key = `${quote.checkedAt}:${quote.xrpAmount}:${quote.slippageBps}`;
    if (lastQuoteEventRef.current === key) return;
    lastQuoteEventRef.current = key;
    trackFunnelEvent('quote_preview');
  }, [open, quote?.checkedAt, quote?.xrpAmount, quote?.slippageBps, trackFunnelEvent]);

  useEffect(() => {
    const status = statusQuery.data?.status;
    if (!activePayload || !status || status === 'pending') return;
    const handledKey = `${activePayload.payloadId}:${status}`;
    if (handledStatusesRef.current.has(handledKey)) return;
    handledStatusesRef.current.add(handledKey);
    setTradeStatus(status);
    if (status === 'completed') trackFunnelEvent('buy_completed');
    else if (status === 'unfilled') trackFunnelEvent('buy_unfilled');
    else if (status === 'failed') trackFunnelEvent('buy_failed');
    else if (status === 'rejected') trackFunnelEvent(activePayload.transactionType === 'buy' ? 'buy_rejected' : 'trustline_rejected');
    else if (status === 'expired') trackFunnelEvent(activePayload.transactionType === 'buy' ? 'buy_expired' : 'trustline_expired');
    else if (status === 'wallet_mismatch') trackFunnelEvent(activePayload.transactionType === 'buy' ? 'buy_wallet_mismatch' : 'trustline_wallet_mismatch');
    if (status === 'completed' || (status === 'signed' && activePayload.transactionType === 'trustline')) {
      window.setTimeout(() => {
        void refreshBalance();
      }, 4_000);
    }
  }, [activePayload, refreshBalance, statusQuery.data?.status, trackFunnelEvent]);

  const prepareTrustline = () => trustlineMutation.mutate(undefined,
    {
      onError: (error) => setBalanceNotice(apiErrorMessage(error, 'Could not prepare the trustline in Xaman.')),
    },
  );
  const prepareBuy = () => buyMutation.mutate(
    { data: { xrpAmount, slippageBps } },
    { onError: (error) => setBalanceNotice(apiErrorMessage(error, 'Could not prepare the buy order in Xaman.')) },
  );

  const busy = trustlineMutation.isPending || buyMutation.isPending;
  const openDialog = () => {
    setActivePayload(null);
    setTradeStatus(null);
    setBalanceNotice('');
    lastQuoteEventRef.current = null;
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-2 py-1.5 text-[9px] font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90 sm:px-2.5 sm:text-[10px]"
        data-testid="button-buy-hermit"
        aria-label="Buy $HERMIT"
        title="Buy $HERMIT"
      >
        Buy
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pr-8">
            <DialogTitle>Buy $HERMIT with XRP</DialogTitle>
            <DialogDescription>
              Frogtown prepares an XRPL order; Xaman is where you review and approve it. Frogtown never holds your funds.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">$HERMIT balance</p>
                    <p className="mt-1 break-words font-mono text-sm font-semibold" data-testid="text-hermit-wallet-balance">
                      {currentBalance?.checkStatus === 'checked'
                        ? `${formatHermit(currentBalance.balance)} $HERMIT`
                        : 'Checking XRPL…'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">XRP balance</p>
                    <p className="mt-1 break-words font-mono text-sm font-semibold" data-testid="text-xrp-wallet-balance">
                      {currentBalance?.xrpCheckStatus === 'checked'
                        ? `${formatXrp(currentBalance.xrpBalance)} XRP`
                        : 'Checking XRPL…'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshBalance()}
                  disabled={refreshingBalance}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2 py-1.5 text-xs hover:bg-[hsl(var(--background))] disabled:opacity-50"
                  data-testid="button-refresh-hermit-balance"
                >
                  <RotateCw className={`size-3.5 ${refreshingBalance ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              <p className="mt-1 break-all font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                Connected wallet: {walletAddress}
              </p>
              {balanceNotice && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" role="status">{balanceNotice}</p>}
            </section>

            {balanceQuery.isError ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--destructive)/.35)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">
                <span>{apiErrorMessage(balanceQuery.error, 'Could not check the XRPL balance. Try again.')}</span>
                <button type="button" onClick={() => void refreshBalance()} className="shrink-0 font-semibold underline">Retry</button>
              </div>
            ) : currentBalance?.checkStatus === 'checked' && currentBalance.trustlineExists === false ? (
              <section className="space-y-3 rounded-xl border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.08)] p-4">
                <div className="flex gap-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[hsl(var(--accent))]" />
                  <div>
                    <p className="text-sm font-semibold">Create the $HERMIT trustline first</p>
                    <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                      XRPL requires a trustline before this wallet can receive $HERMIT. Frogtown will request a 1,000,000,000-token limit. The trustline itself does not buy or send tokens; XRPL fees and reserve requirements apply.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={prepareTrustline}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                  data-testid="button-create-hermit-trustline"
                >
                  {trustlineMutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
                  Prepare trustline in Xaman
                </button>
              </section>
            ) : currentBalance?.checkStatus === 'unavailable' ? (
              <p className="rounded-lg border border-[hsl(var(--destructive)/.35)] p-3 text-sm text-[hsl(var(--destructive))]" role="alert">
                Frogtown could not check your trustline. Refresh the balance before preparing a trade.
              </p>
            ) : currentBalance?.trustlineExists === true ? (
              <section className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium">Spend up to</span>
                  <span className="flex items-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={xrpAmount}
                      onChange={(event) => setXrpAmount(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm outline-none"
                      aria-label="XRP amount to spend"
                      data-testid="input-hermit-buy-xrp"
                    />
                    <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">XRP</span>
                  </span>
                  <span className="block text-[11px] text-[hsl(var(--muted-foreground))]">0.01–1,000 XRP; up to six decimal places.</span>
                </label>

                <label className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">Maximum slippage</span>
                  <select
                    value={slippageBps}
                    onChange={(event) => setSlippageBps(Number(event.target.value))}
                    className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 font-mono"
                    aria-label="Maximum slippage"
                    data-testid="select-hermit-slippage"
                  >
                    {SLIPPAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {quote ? (
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-[hsl(var(--border))] p-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Estimated receive</p>
                      <p className="mt-1 font-mono text-sm font-semibold">{formatHermit(quote.expectedHermit)} $HERMIT</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Minimum receive</p>
                      <p className="mt-1 font-mono text-sm font-semibold">{formatHermit(quote.minimumHermit)} $HERMIT</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Estimated price impact</p>
                      <p className={`mt-1 font-mono text-sm font-semibold ${quote.priceImpactPercent >= 5 ? 'text-[hsl(var(--destructive))]' : ''}`}>
                        {quote.priceImpactPercent.toFixed(2)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">AMM fee / XRP reserve</p>
                      <p className="mt-1 font-mono text-sm">{(quote.ammFeeBps / 100).toFixed(2)}% / {formatHermit(quote.xrpReserve)} XRP</p>
                    </div>
                  </div>
                ) : quoteQuery.isError ? (
                  <p className="rounded-lg border border-[hsl(var(--destructive)/.35)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">
                    {apiErrorMessage(quoteQuery.error, 'Could not get a fresh XRPL quote.')}
                  </p>
                ) : quoteQuery.isFetching ? (
                  <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]" role="status">
                    <LoaderCircle className="size-3.5 animate-spin" /> Loading an XRPL quote…
                  </p>
                ) : !amountIsValid ? (
                  <p className="text-xs text-[hsl(var(--destructive))]" role="alert">Enter an amount between 0.01 and 1,000 XRP.</p>
                ) : null}

                <div className="flex gap-2 rounded-lg border border-[hsl(var(--accent)/.4)] bg-[hsl(var(--accent)/.08)] p-3 text-xs leading-5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-[hsl(var(--accent))]" />
                  <p>
                    The live pool is thin. The quote can change before the ledger processes your order. The order is immediate-or-cancel, so any unfilled XRP is not left as an open offer. Network fees still apply.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={prepareBuy}
                  disabled={!quote || busy || !amountIsValid}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                  data-testid="button-prepare-hermit-buy"
                >
                  {buyMutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
                  Prepare buy order in Xaman
                </button>
              </section>
            ) : (
              <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]" role="status">
                <LoaderCircle className="size-4 animate-spin" /> Checking your XRPL trustline…
              </p>
            )}

            {activePayload && (
              <section className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid="panel-hermit-xaman-payload">
                <div className="flex items-start gap-2">
                  {tradeStatus === 'completed'
                    ? <Check className="mt-0.5 size-4 shrink-0 text-[hsl(var(--primary))]" />
                    : <CircleAlert className="mt-0.5 size-4 shrink-0 text-[hsl(var(--accent))]" />}
                  <p className="text-xs leading-5">{statusCopy(tradeStatus ?? 'pending', activePayload.transactionType)}</p>
                </div>
                {tradeStatus === 'completed' && statusQuery.data?.receivedHermit && (
                  <div className="rounded-lg border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] px-3 py-3" data-testid="text-hermit-buy-actual-received">
                    <p className="text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Confirmed amount received</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-[hsl(var(--primary))]">
                      {formatExactHermit(statusQuery.data.receivedHermit)} $HERMIT
                    </p>
                  </div>
                )}
                {statusQuery.isError && (
                  <p className="text-xs text-[hsl(var(--destructive))]" role="alert">
                    {apiErrorMessage(statusQuery.error, 'Xaman status could not be checked. Try again.')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={activePayload.deeplink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary-foreground))]"
                    data-testid="link-open-hermit-xaman"
                  >
                    Open in Xaman <ArrowUpRight className="size-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void statusQuery.refetch()}
                    disabled={statusQuery.isFetching}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    data-testid="button-check-hermit-xaman-status"
                  >
                    {statusQuery.isFetching ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                    Check Xaman status
                  </button>
                </div>
                <div className="flex flex-col items-center gap-2 rounded-lg bg-white p-3 sm:flex-row">
                  <img src={activePayload.qrUrl} alt="Xaman approval QR code" className="size-32" />
                  <p className="text-center text-xs text-slate-600 sm:text-left">
                    Scan with Xaman, then verify the wallet address and transaction details before approving.
                  </p>
                </div>
                {activePayload.quote && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    Order: up to {activePayload.quote.xrpAmount} XRP for at least {formatHermit(activePayload.quote.minimumHermit)} $HERMIT, with {activePayload.quote.priceImpactPercent.toFixed(2)}% estimated impact. Approval is final once submitted to XRPL.
                  </p>
                )}
                {(tradeStatus === 'signed' || tradeStatus === 'completed') && (
                  <button
                    type="button"
                    onClick={() => void refreshBalance()}
                    disabled={refreshingBalance}
                    className="text-xs font-semibold text-[hsl(var(--primary))] underline underline-offset-2"
                  >
                    Refresh $HERMIT balance
                  </button>
                )}
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
