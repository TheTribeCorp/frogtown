import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { ReownWalletProvider } from '@/lib/ladychain-reown-runtime';
import {
  readableLadyChainWalletError,
  setActiveLadyChainProvider,
  type Eip1193Provider,
} from '@/lib/ladychain-wallet';
import { useLadyChainAuthentication } from '@/hooks/use-ladychain-auth';

export type LadyChainMobileWalletConnectProps = {
  onConnected: (walletAddress: string) => void;
  onCancel: () => void;
  disabled: boolean;
  autoOpen?: boolean;
};

export function LadyChainMobileWalletConnect(props: LadyChainMobileWalletConnectProps) {
  return (
    <ReownWalletProvider>
      <LadyChainMobileWalletConnectInner {...props} />
    </ReownWalletProvider>
  );
}

function LadyChainMobileWalletConnectInner({
  onConnected,
  onCancel,
  disabled,
  autoOpen = false,
}: LadyChainMobileWalletConnectProps) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount({ namespace: 'eip155' });
  const { walletProvider } = useAppKitProvider('eip155');
  const authenticate = useLadyChainAuthentication();
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('');
  const attemptedAddress = useRef('');
  const busyRef = useRef(false);
  const openedRef = useRef(false);
  const providerRef = useRef<Eip1193Provider | null>(null);
  const authenticateRef = useRef(authenticate);
  const onConnectedRef = useRef(onConnected);
  providerRef.current = walletProvider as Eip1193Provider | null;
  authenticateRef.current = authenticate;
  onConnectedRef.current = onConnected;

  const openSelector = useCallback(async () => {
    setError('');
    setRequested(true);
    setStep('Choose your wallet in the secure wallet selector…');
    try {
      await open({ view: 'Connect', namespace: 'eip155' });
    } catch (connectError) {
      setRequested(false);
      setError(readableLadyChainWalletError(connectError));
      setStep('');
    }
  }, [open]);

  useEffect(() => {
    if (!autoOpen || openedRef.current) return;
    openedRef.current = true;
    void openSelector();
  }, [autoOpen, openSelector]);

  useEffect(() => {
    if (!requested || !isConnected || !address || !providerRef.current || busyRef.current) return;
    const normalizedAddress = address.toLowerCase();
    if (attemptedAddress.current === normalizedAddress) return;
    attemptedAddress.current = normalizedAddress;
    const provider = providerRef.current;
    if (!provider) return;
    busyRef.current = true;

    void (async () => {
      setBusy(true);
      setError('');
      setStep('Approve the free Frogtown login message in your wallet…');
      try {
        setActiveLadyChainProvider(provider);
        const walletAddress = await authenticateRef.current(provider, normalizedAddress);
        setRequested(false);
        onConnectedRef.current(walletAddress);
      } catch (connectError) {
        attemptedAddress.current = '';
        setRequested(false);
        setError(readableLadyChainWalletError(connectError));
        setStep('');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [address, isConnected, requested, walletProvider]);

  return (
    <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">
          {busy ? step : requested ? 'Choose your wallet app or browser extension.' : 'Open the mobile wallet selector.'}
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy || disabled}
          className="shrink-0 text-xs text-[hsl(var(--muted-foreground))] underline underline-offset-2 disabled:opacity-50"
          data-testid="button-cancel-ladychain-walletconnect"
        >
          Cancel
        </button>
      </div>
      {!requested && (
        <button
          type="button"
          onClick={() => void openSelector()}
          disabled={disabled || busy}
          className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-[hsl(var(--primary)/.35)] px-3 text-xs font-medium text-[hsl(var(--foreground))] disabled:opacity-60"
        >
          Open wallet selector <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {requested && !isConnected && (
        <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]" role="status">{step}</p>
      )}
      {busy && <LoaderCircle className="mt-2 size-4 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />}
      <p className="mt-2 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
        Supports mobile wallet links and desktop QR connections. Frogtown only asks you to sign a free login message.
      </p>
      {error && (
        <p className="mt-2 rounded-lg border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.06)] px-3 py-2 text-xs leading-5 text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
