import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ArrowUpRight, LoaderCircle, WalletCards } from 'lucide-react';
import type { Eip1193Provider } from '@/lib/ladychain-wallet';
import { getInjectedEvmProviders, setActiveLadyChainProvider, readableLadyChainWalletError } from '@/lib/ladychain-wallet';
import { mobileWalletConnectionConfigured } from '@/lib/ladychain-appkit';
import { useLadyChainAuthentication } from '@/hooks/use-ladychain-auth';
import type { LadyChainMobileWalletConnectProps } from './ladychain-mobile-wallet-connect';

type MobileWalletConnectModule = typeof import('./ladychain-mobile-wallet-connect');
let mobileWalletConnectModulePromise: Promise<MobileWalletConnectModule> | undefined;

function loadMobileWalletConnect() {
  mobileWalletConnectModulePromise ??= import('./ladychain-mobile-wallet-connect').catch((error) => {
    mobileWalletConnectModulePromise = undefined;
    throw error;
  });
  return mobileWalletConnectModulePromise;
}

function providerLabel(provider: Eip1193Provider, index: number) {
  if (provider.isSafePal) return 'SafePal';
  if (provider.isMetaMask) return 'MetaMask';
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isTrust) return 'Trust Wallet';
  if (provider.isRabby) return 'Rabby';
  return provider.info?.name || (index === 0 ? 'EVM wallet' : `EVM wallet ${index + 1}`);
}

export function LadyChainConnect({ onConnected }: { onConnected: (walletAddress: string) => void }) {
  const authenticate = useLadyChainAuthentication();
  const [providers, setProviders] = useState<Eip1193Provider[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [showMobileWalletConnect, setShowMobileWalletConnect] = useState(false);
  const [MobileWalletConnect, setMobileWalletConnect] = useState<ComponentType<LadyChainMobileWalletConnectProps> | null>(null);
  const [mobileWalletModuleLoading, setMobileWalletModuleLoading] = useState(false);
  const [mobileWalletModuleError, setMobileWalletModuleError] = useState(false);
  const mobileWalletButton = useRef<HTMLButtonElement>(null);
  const preloaded = useRef(false);

  async function openMobileWalletConnect() {
    setShowMobileWalletConnect(true);
    if (MobileWalletConnect) return;
    setMobileWalletModuleLoading(true);
    setMobileWalletModuleError(false);
    try {
      const module = await loadMobileWalletConnect();
      setMobileWalletConnect(() => module.LadyChainMobileWalletConnect);
    } catch {
      setMobileWalletModuleError(true);
    } finally {
      setMobileWalletModuleLoading(false);
    }
  }

  function preloadMobileWalletConnect() {
    if (preloaded.current || !mobileWalletConnectionConfigured) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    preloaded.current = true;
    void loadMobileWalletConnect().catch(() => {
      preloaded.current = false;
    });
  }

  useEffect(() => {
    const refresh = () => setProviders(getInjectedEvmProviders());
    const announce = (event: Event) => {
      const provider = (event as CustomEvent<{ provider?: Eip1193Provider }>).detail?.provider;
      if (provider?.request) setProviders((current) => [...new Set([...current, provider])]);
    };
    refresh();
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);

  useEffect(() => {
    const button = mobileWalletButton.current;
    if (!mobileWalletConnectionConfigured || !button || typeof IntersectionObserver === 'undefined') return;

    let dwellTimer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        window.clearTimeout(dwellTimer);
        return;
      }
      dwellTimer = window.setTimeout(preloadMobileWalletConnect, 900);
    }, { threshold: 0.35 });

    observer.observe(button);
    return () => {
      window.clearTimeout(dwellTimer);
      observer.disconnect();
    };
  }, []);

  async function connect(provider: Eip1193Provider) {
    setError('');
    setBusy(true);
    try {
      setStep('Switching your wallet to LadyChain…');
      setActiveLadyChainProvider(provider);
      setStep('Waiting for wallet approval…');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
        throw new Error('This wallet did not return a valid EVM address.');
      }
      setStep('Sign the free Frogtown login message…');
      const walletAddress = await authenticate(provider, accounts[0]);
      onConnected(walletAddress);
    } catch (connectError) {
      setError(readableLadyChainWalletError(connectError));
      setStep('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-3 rounded-2xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.035)] p-4"
      aria-labelledby="ladychain-connect-title"
      data-testid="card-ladychain-connect"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
          <WalletCards className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="ladychain-connect-title" className="text-sm font-semibold">LadyChain wallet</h3>
          <p className="mono mt-0.5 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Chain 589 · LADY</p>
        </div>
      </div>

      {providers.length > 0 && (
        <div className="mt-3 grid gap-2">
          {providers.map((provider, index) => (
            <button
              key={provider.info?.uuid ?? `${providerLabel(provider, index)}-${index}`}
              type="button"
              onClick={() => void connect(provider)}
              disabled={busy}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-left text-sm font-medium transition hover:border-[hsl(var(--primary)/.5)] disabled:cursor-wait disabled:opacity-60"
              data-testid={`button-connect-ladychain-${index}`}
            >
              <span>{busy ? step : `Connect ${providerLabel(provider, index)}`}</span>
              {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      {mobileWalletConnectionConfigured ? (
        <>
          {!showMobileWalletConnect && (
            <button
              type="button"
              onClick={() => void openMobileWalletConnect()}
              onPointerEnter={preloadMobileWalletConnect}
              onFocus={preloadMobileWalletConnect}
              onTouchStart={preloadMobileWalletConnect}
              disabled={busy}
              className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] px-4 text-left text-sm font-medium transition hover:border-[hsl(var(--primary)/.65)] disabled:opacity-60"
              ref={mobileWalletButton}
              data-testid="button-open-ladychain-mobile-wallets"
            >
              <span>Connect from any mobile wallet</span>
              <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
            </button>
          )}
          {showMobileWalletConnect && (
            <div className="mt-3">
              {mobileWalletModuleLoading && !MobileWalletConnect && (
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]" role="status" aria-live="polite">
                  Loading secure wallet selector…
                  <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setShowMobileWalletConnect(false)}>Cancel</button>
                </div>
              )}
              {mobileWalletModuleError && (
                <div className="rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.06)] px-3 py-3 text-xs text-[hsl(var(--destructive))]" role="alert">
                  Couldn’t load the wallet selector. Check your connection and try again.
                  <button type="button" className="ml-2 underline underline-offset-2" onClick={() => void openMobileWalletConnect()}>Retry</button>
                  <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setShowMobileWalletConnect(false)}>Cancel</button>
                </div>
              )}
              {MobileWalletConnect && (
                <MobileWalletConnect
                  onConnected={onConnected}
                  disabled={busy}
                  onCancel={() => setShowMobileWalletConnect(false)}
                  autoOpen
                />
              )}
            </div>
          )}
        </>
      ) : providers.length === 0 ? (
        <p className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-3 py-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]" role="status">
          Mobile wallet selection is being configured. For now, open Frogtown in your wallet’s built-in browser or use an injected wallet extension.
        </p>
      ) : null}

      <p className="mt-3 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
        After changing accounts, Frogtown asks you to sign in again and switches the session to that account. Sign-in uses a free message, not a transaction. Network details: <a className="underline underline-offset-2" href="https://ladyscan.us" target="_blank" rel="noreferrer">LadyScan</a>.
      </p>
      {step && !error && !busy && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" role="status">{step}</p>}
      {error && <p className="mt-3 rounded-lg border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.06)] px-3 py-2 text-xs leading-5 text-[hsl(var(--destructive))]" role="alert" data-testid="error-ladychain-connect">{error}</p>}
    </section>
  );
}
