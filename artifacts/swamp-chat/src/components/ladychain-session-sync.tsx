import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { mobileWalletConnectionConfigured } from '@/lib/ladychain-appkit';
import { readableLadyChainWalletError } from '@/lib/ladychain-wallet';
import {
  ensureLadyChainNetwork,
  findConnectedEvmProvider,
  isEvmAddress,
  listenToProvider,
  normalizeEvmAddress,
  normalizeEvmChainId,
  LADYCHAIN_CHAIN_ID,
  setActiveLadyChainProvider,
  type Eip1193Provider,
} from '@/lib/ladychain-wallet';
import { useLadyChainAuthentication } from '@/hooks/use-ladychain-auth';

export type SessionSyncProps = {
  walletAddress: string;
  setWalletAddress: (address: string) => void;
  disconnect: () => void;
};

const LazyAppKitSessionSync = lazy(() =>
  import('./ladychain-appkit-session-sync').then((module) => ({
    default: module.LadyChainAppKitSessionSync,
  })),
);

export function LadyChainSessionSync(props: SessionSyncProps) {
  if (mobileWalletConnectionConfigured && isEvmAddress(props.walletAddress)) {
    return (
      <Suspense fallback={<WalletSessionLoading />}>
        <LazyAppKitSessionSync {...props} />
      </Suspense>
    );
  }
  return <LadyChainSessionSyncCore {...props} />;
}

function WalletSessionLoading() {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[hsl(var(--background)/.84)] p-5 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-label="Restoring LadyChain wallet connection"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl">
        <LoaderCircle className="size-5 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
        <p className="text-sm font-medium">Restoring your LadyChain wallet session…</p>
      </div>
    </div>
  );
}

export function LadyChainSessionSyncCore({
  walletAddress,
  setWalletAddress,
  disconnect,
  preferredProvider = null,
  preferredProviderConnected = false,
}: SessionSyncProps & {
  preferredProvider?: Eip1193Provider | null;
  preferredProviderConnected?: boolean;
}) {
  const queryClient = useQueryClient();
  const authenticate = useLadyChainAuthentication();
  const [switching, setSwitching] = useState(false);
  const [switchMessage, setSwitchMessage] = useState('');
  const currentWallet = useRef(walletAddress.toLowerCase());
  const pendingAccount = useRef<string | undefined>(undefined);
  const flowActive = useRef(false);
  const networkSwitchActive = useRef(false);

  useEffect(() => {
    currentWallet.current = walletAddress.toLowerCase();
  }, [walletAddress]);

  const processAccountQueue = useCallback(async (provider: Eip1193Provider) => {
    if (flowActive.current) return;
    flowActive.current = true;
    setSwitching(true);
    setSwitchMessage('Your wallet account changed. Approve a free sign-in message to continue.');

    const authenticateQueuedAccount = async () => {
      while (pendingAccount.current !== undefined) {
        const nextAddress = pendingAccount.current;
        pendingAccount.current = undefined;
        if (!nextAddress) {
          disconnect();
          return;
        }
        const normalizedAddress = normalizeEvmAddress(nextAddress);
        if (!normalizedAddress) {
          disconnect();
          return;
        }
        if (normalizedAddress === currentWallet.current) continue;
        const sharedSessionAddress = window.localStorage.getItem('swamp-wallet-address')?.toLowerCase();
        if (sharedSessionAddress === normalizedAddress) {
          queryClient.clear();
          currentWallet.current = normalizedAddress;
          setWalletAddress(sharedSessionAddress);
          continue;
        }

        try {
          const signedInAddress = await authenticate(provider, normalizedAddress);
          if (pendingAccount.current !== undefined) continue;

          const accounts = await provider.request({ method: 'eth_accounts' });
          const chainId = await provider.request({ method: 'eth_chainId' });
          const activeAddress = Array.isArray(accounts) ? normalizeEvmAddress(accounts[0]) : null;
          if (activeAddress !== normalizedAddress) {
            pendingAccount.current = activeAddress ?? '';
            continue;
          }
          if (normalizeEvmChainId(chainId) !== LADYCHAIN_CHAIN_ID) {
            await ensureLadyChainNetwork(provider);
          }

          queryClient.clear();
          currentWallet.current = signedInAddress.toLowerCase();
          setWalletAddress(signedInAddress);
        } catch (error) {
          if (pendingAccount.current !== undefined && pendingAccount.current !== normalizedAddress) continue;
          try {
            window.sessionStorage.setItem('frogtown-ladychain-sync-error', readableLadyChainWalletError(error));
          } catch {
            // The sign-in screen still explains that the wallet must be connected again.
          }
          disconnect();
          return;
        }
      }
    };

    try {
      if (typeof navigator !== 'undefined' && navigator.locks?.request) {
        await navigator.locks.request('frogtown-ladychain-session-sync', authenticateQueuedAccount);
      } else {
        await authenticateQueuedAccount();
      }
    } finally {
      flowActive.current = false;
      setSwitching(false);
      setSwitchMessage('');
    }
  }, [authenticate, disconnect, queryClient, setWalletAddress]);

  const queueAccountChange = useCallback((provider: Eip1193Provider, address: string | null) => {
    pendingAccount.current = address ?? '';
    void processAccountQueue(provider);
  }, [processAccountQueue]);

  useEffect(() => {
    if (!isEvmAddress(walletAddress)) return;
    let cancelled = false;
    let activeProvider: Eip1193Provider | null = null;
    const cleanupListeners: Array<() => void> = [];

    const attachProvider = async (provider: Eip1193Provider | null) => {
      if (cancelled || !provider || activeProvider === provider) return;
      let accounts: unknown;
      try {
        accounts = await provider.request({ method: 'eth_accounts' });
      } catch {
        return;
      }
      if (cancelled || !Array.isArray(accounts) || !accounts.some(isEvmAddress)) return;

      activeProvider = provider;
      setActiveLadyChainProvider(provider);
      cleanupListeners.push(
        listenToProvider(provider, 'accountsChanged', (value) => {
          const nextAddress = Array.isArray(value) ? normalizeEvmAddress(value[0]) : null;
          if (nextAddress === currentWallet.current) return;
          queueAccountChange(provider, nextAddress);
        }),
      );
      cleanupListeners.push(
        listenToProvider(provider, 'chainChanged', (value) => {
          if (normalizeEvmChainId(value) === LADYCHAIN_CHAIN_ID || networkSwitchActive.current) return;
          networkSwitchActive.current = true;
          setSwitching(true);
          setSwitchMessage('Switching your wallet back to LadyChain…');
          void ensureLadyChainNetwork(provider)
            .catch((error) => {
              try {
                window.sessionStorage.setItem('frogtown-ladychain-sync-error', readableLadyChainWalletError(error));
              } catch {
                // The sign-in screen still explains that the wallet must be connected again.
              }
              disconnect();
            })
            .finally(() => {
              networkSwitchActive.current = false;
              setSwitching(false);
              setSwitchMessage('');
            });
        }),
      );
      cleanupListeners.push(
        listenToProvider(provider, 'disconnect', () => disconnect()),
      );

      const chainId = await provider.request({ method: 'eth_chainId' }).catch(() => null);
      if (normalizeEvmChainId(chainId) !== null && normalizeEvmChainId(chainId) !== LADYCHAIN_CHAIN_ID) {
        try {
          await ensureLadyChainNetwork(provider);
        } catch (error) {
          try {
            window.sessionStorage.setItem('frogtown-ladychain-sync-error', readableLadyChainWalletError(error));
          } catch {
            // The sign-in screen still explains that the wallet must be connected again.
          }
          disconnect();
          return;
        }
      }

      const currentAccounts = await provider.request({ method: 'eth_accounts' }).catch(() => []);
      const activeAddress = Array.isArray(currentAccounts) ? normalizeEvmAddress(currentAccounts[0]) : null;
      if (activeAddress && activeAddress !== currentWallet.current) {
        queueAccountChange(provider, activeAddress);
      }
    };

    void (async () => {
      const provider = await findConnectedEvmProvider(
        preferredProviderConnected ? preferredProvider : null,
        walletAddress,
      );
      await attachProvider(provider);
    })();

    const onProviderAnnounced = (event: Event) => {
      const provider = (event as CustomEvent<{ provider?: Eip1193Provider }>).detail?.provider;
      if (provider?.request) void attachProvider(provider);
    };
    window.addEventListener('eip6963:announceProvider', onProviderAnnounced);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    return () => {
      cancelled = true;
      cleanupListeners.forEach((cleanup) => cleanup());
      window.removeEventListener('eip6963:announceProvider', onProviderAnnounced);
      if (activeProvider && activeProvider === preferredProvider) {
        setActiveLadyChainProvider(null);
      }
    };
  }, [
    disconnect,
    preferredProvider,
    preferredProviderConnected,
    queueAccountChange,
    walletAddress,
  ]);

  if (!switching) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[hsl(var(--background)/.84)] p-5 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-label="Updating your LadyChain wallet session"
      data-testid="ladychain-session-sync"
    >
      <div className="flex w-full max-w-sm items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]">
          {switchMessage.includes('changed') ? <ShieldCheck className="size-5" aria-hidden="true" /> : <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
        </span>
        <div>
          <h2 className="text-sm font-semibold">Updating your wallet session</h2>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]" aria-live="polite">{switchMessage}</p>
          <p className="mt-2 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">Your account-specific Frogtown data stays hidden until the wallet is verified.</p>
        </div>
      </div>
    </div>
  );
}
