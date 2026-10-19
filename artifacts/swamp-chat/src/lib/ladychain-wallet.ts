export const LADYCHAIN_CHAIN_ID = 589;
export const LADYCHAIN_CHAIN_ID_HEX = '0x24d';

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  providers?: Eip1193Provider[];
  isMetaMask?: boolean;
  isSafePal?: boolean;
  isCoinbaseWallet?: boolean;
  isTrust?: boolean;
  isRabby?: boolean;
  info?: { name?: string; uuid?: string };
};

let activeLadyChainProvider: Eip1193Provider | null = null;

export function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normalizeEvmAddress(value: unknown): string | null {
  return isEvmAddress(value) ? value.toLowerCase() : null;
}

export function normalizeEvmChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = value.startsWith('0x') ? Number.parseInt(value.slice(2), 16) : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function getInjectedEvmProviders(): Eip1193Provider[] {
  if (typeof window === 'undefined') return [];
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!injected) return [];
  const candidates = injected.providers?.length ? injected.providers : [injected];
  return [...new Set(candidates)];
}

export function setActiveLadyChainProvider(provider: Eip1193Provider | null) {
  activeLadyChainProvider = provider;
}

export async function findConnectedEvmProvider(
  preferredProvider?: Eip1193Provider | null,
  expectedAddress?: string,
): Promise<Eip1193Provider | null> {
  const normalizedExpected = normalizeEvmAddress(expectedAddress);
  const candidates = [
    activeLadyChainProvider,
    preferredProvider ?? null,
    ...getInjectedEvmProviders(),
  ].filter((provider): provider is Eip1193Provider => Boolean(provider));
  const uniqueCandidates = [...new Set(candidates)];
  const connected: Eip1193Provider[] = [];

  for (const provider of uniqueCandidates) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (!Array.isArray(accounts) || !accounts.some(isEvmAddress)) continue;
      connected.push(provider);
      if (normalizedExpected && accounts.some((account) => normalizeEvmAddress(account) === normalizedExpected)) {
        return provider;
      }
    } catch {
      // A wallet may be present in the browser but locked or disconnected.
    }
  }

  if (activeLadyChainProvider && connected.includes(activeLadyChainProvider)) return activeLadyChainProvider;
  if (preferredProvider && connected.includes(preferredProvider)) return preferredProvider;
  return connected.length === 1 ? connected[0] : null;
}

export async function ensureLadyChainNetwork(provider: Eip1193Provider): Promise<void> {
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (normalizeEvmChainId(chainId) === LADYCHAIN_CHAIN_ID) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: LADYCHAIN_CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    const code = typeof switchError === 'object' && switchError !== null && 'code' in switchError
      ? Number((switchError as { code?: unknown }).code)
      : undefined;
    if (code !== 4902) throw switchError;

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: LADYCHAIN_CHAIN_ID_HEX,
        chainName: 'LadyChain',
        nativeCurrency: { name: 'LADY', symbol: 'LADY', decimals: 18 },
        rpcUrls: ['https://ladyrpc.us'],
        blockExplorerUrls: ['https://ladyscan.us'],
      }],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: LADYCHAIN_CHAIN_ID_HEX }],
    });
  }

  const activeChainId = await provider.request({ method: 'eth_chainId' });
  if (normalizeEvmChainId(activeChainId) !== LADYCHAIN_CHAIN_ID) {
    throw new Error('Switch your wallet to LadyChain (chain ID 589) to continue.');
  }
}

export function readableLadyChainWalletError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
  if (code === 4001) return 'Wallet connection or sign-in was cancelled.';
  if (error instanceof Error && error.message) return error.message;
  return 'Could not connect this wallet. Please try again.';
}

export function listenToProvider(
  provider: Eip1193Provider,
  event: string,
  listener: (...args: unknown[]) => void,
): () => void {
  provider.on?.(event, listener);
  return () => {
    provider.removeListener?.(event, listener);
    provider.off?.(event, listener);
  };
}
