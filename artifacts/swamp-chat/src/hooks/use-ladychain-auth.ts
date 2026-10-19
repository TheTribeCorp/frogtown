import { useCallback } from 'react';
import {
  useCreateLadyChainWalletChallenge,
  useCreateLadyChainWalletSession,
} from '@workspace/api-client-react';
import {
  type Eip1193Provider,
} from '@/lib/ladychain-wallet';
import { authenticateLadyChainProvider } from '@/lib/ladychain-auth-flow';

export function useLadyChainAuthentication() {
  const { mutateAsync: createChallenge } = useCreateLadyChainWalletChallenge({
    request: { credentials: 'same-origin' },
  });
  const { mutateAsync: createSession } = useCreateLadyChainWalletSession({
    request: { credentials: 'same-origin' },
  });

  return useCallback(async (provider: Eip1193Provider, requestedAddress: string) => {
    return authenticateLadyChainProvider(
      provider,
      requestedAddress,
      createChallenge,
      createSession,
    );
  }, [createChallenge, createSession]);
}
