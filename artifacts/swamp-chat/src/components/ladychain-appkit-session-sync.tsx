import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { ReownWalletProvider } from '@/lib/ladychain-reown-runtime';
import type { Eip1193Provider } from '@/lib/ladychain-wallet';
import {
  LadyChainSessionSyncCore,
  type SessionSyncProps,
} from '@/components/ladychain-session-sync';

export function LadyChainAppKitSessionSync(props: SessionSyncProps) {
  return (
    <ReownWalletProvider>
      <LadyChainAppKitSessionSyncInner {...props} />
    </ReownWalletProvider>
  );
}

function LadyChainAppKitSessionSyncInner(props: SessionSyncProps) {
  const { isConnected } = useAppKitAccount({ namespace: 'eip155' });
  const { walletProvider } = useAppKitProvider('eip155');
  return (
    <LadyChainSessionSyncCore
      {...props}
      preferredProvider={walletProvider as Eip1193Provider | undefined}
      preferredProviderConnected={isConnected}
    />
  );
}
