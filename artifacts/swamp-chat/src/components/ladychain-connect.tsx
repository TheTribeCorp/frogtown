import { useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle, WalletCards } from 'lucide-react';
import {
  useCreateLadyChainWalletChallenge,
  useCreateLadyChainWalletSession,
} from '@workspace/api-client-react';

const LADYCHAIN_ID = '0x24d';

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  providers?: Eip1193Provider[];
  isMetaMask?: boolean;
  isSafePal?: boolean;
  isCoinbaseWallet?: boolean;
  isTrust?: boolean;
  isRabby?: boolean;
  info?: { name?: string; uuid?: string };
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function providerLabel(provider: Eip1193Provider, index: number) {
  if (provider.isSafePal) return 'SafePal';
  if (provider.isMetaMask) return 'MetaMask';
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isTrust) return 'Trust Wallet';
  if (provider.isRabby) return 'Rabby';
  return provider.info?.name || (index === 0 ? 'EVM wallet' : `EVM wallet ${index + 1}`);
}

function readableWalletError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
  if (code === 4001) return 'Wallet connection or sign-in was cancelled.';
  if (error instanceof Error && error.message) return error.message;
  return 'Could not connect this wallet. Please try again.';
}

export function LadyChainConnect({ onConnected }: { onConnected: (walletAddress: string) => void }) {
  const challengeMutation = useCreateLadyChainWalletChallenge({
    request: { credentials: 'same-origin' },
  });
  const sessionMutation = useCreateLadyChainWalletSession({
    request: { credentials: 'same-origin' },
  });
  const [providers, setProviders] = useState<Eip1193Provider[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const injected = window.ethereum;
    const choices = injected?.providers?.length ? injected.providers : injected ? [injected] : [];
    setProviders([...new Set(choices)]);
  }, []);

  async function connect(provider: Eip1193Provider) {
    setError('');
    setBusy(true);
    try {
      setStep('Switching your wallet to LadyChain…');
      const currentChainId = await provider.request({ method: 'eth_chainId' });
      if (typeof currentChainId !== 'string') {
        throw new Error('This wallet did not report its current network.');
      }
      if (currentChainId.toLowerCase() !== LADYCHAIN_ID) {
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: LADYCHAIN_ID }],
          });
        } catch (switchError) {
          const code = typeof switchError === 'object' && switchError !== null && 'code' in switchError
            ? Number((switchError as { code?: unknown }).code)
            : undefined;
          if (code !== 4902) throw switchError;
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: LADYCHAIN_ID,
              chainName: 'LadyChain',
              nativeCurrency: { name: 'LADY', symbol: 'LADY', decimals: 18 },
              rpcUrls: ['https://ladyrpc.us'],
              blockExplorerUrls: ['https://ladyscan.us'],
            }],
          });
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: LADYCHAIN_ID }],
          });
        }
      }

      const activeChainId = await provider.request({ method: 'eth_chainId' });
      if (typeof activeChainId !== 'string' || activeChainId.toLowerCase() !== LADYCHAIN_ID) {
        throw new Error('Switch your wallet to LadyChain (chain ID 589) to continue.');
      }

      setStep('Waiting for wallet approval…');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])) {
        throw new Error('This wallet did not return a valid EVM address.');
      }
      const address = accounts[0].toLowerCase();

      setStep('Preparing a secure sign-in…');
      const challenge = await challengeMutation.mutateAsync({ data: { address } });

      setStep('Approve the free sign-in message in your wallet…');
      const signature = await provider.request({
        method: 'personal_sign',
        params: [challenge.message, address],
      });
      if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
        throw new Error('The wallet did not return a valid sign-in signature.');
      }

      const session = await sessionMutation.mutateAsync({
        data: { address, nonce: challenge.nonce, signature },
      });
      onConnected(session.walletAddress);
    } catch (connectError) {
      setError(readableWalletError(connectError));
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

      {providers.length > 0 ? (
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
      ) : (
        <p className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-3 py-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]" role="status">
          Open Frogtown in your MetaMask, SafePal, or other EVM wallet’s built-in browser, or use a wallet extension in this browser.
        </p>
      )}

      <p className="mt-3 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
        Sign-in only: your wallet approves a short message, not a transaction. Network details: <a className="underline underline-offset-2" href="https://ladyscan.us" target="_blank" rel="noreferrer">LadyScan</a>.
      </p>
      {step && !error && !busy && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" role="status">{step}</p>}
      {error && <p className="mt-3 rounded-lg border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.06)] px-3 py-2 text-xs leading-5 text-[hsl(var(--destructive))]" role="alert" data-testid="error-ladychain-connect">{error}</p>}
    </section>
  );
}
