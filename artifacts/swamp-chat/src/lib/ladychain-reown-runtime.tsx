import type { ReactNode } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { defineChain } from '@reown/appkit/networks';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { WagmiProvider } from 'wagmi';
import { reownProjectId } from '@/lib/ladychain-appkit';

const ladyChainNetwork = defineChain({
  id: 589,
  caipNetworkId: 'eip155:589',
  chainNamespace: 'eip155',
  name: 'LadyChain',
  nativeCurrency: {
    decimals: 18,
    name: 'LADY',
    symbol: 'LADY',
  },
  rpcUrls: {
    default: { http: ['https://ladyrpc.us'] },
  },
  blockExplorers: {
    default: { name: 'LadyScan', url: 'https://ladyscan.us' },
  },
});

const wagmiAdapter = new WagmiAdapter({
  networks: [ladyChainNetwork],
  projectId: reownProjectId,
  ssr: false,
});

const origin = typeof window === 'undefined' ? 'https://frogtown.online' : window.location.origin;
createAppKit({
  adapters: [wagmiAdapter],
  networks: [ladyChainNetwork],
  defaultNetwork: ladyChainNetwork,
  projectId: reownProjectId,
  metadata: {
    name: 'Frogtown',
    description: 'Wallet-native chats, community rooms, and a shared timeline.',
    url: origin,
    icons: [`${origin}/images/hermit-mascot.jpg`],
  },
  defaultAccountTypes: { eip155: 'eoa' },
  features: {
    connectMethodsOrder: ['wallet'],
    analytics: false,
    email: false,
    socials: false,
    history: false,
    onramp: false,
    swaps: false,
    send: false,
    receive: false,
    smartSessions: false,
    pay: false,
  },
});

export function ReownWalletProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiAdapter.wagmiConfig}>{children}</WagmiProvider>;
}
