import { getGetWalletHermitBalanceQueryKey } from '@workspace/api-client-react';

export function hermitBalanceQueryKey(walletAddress: string, refresh = false) {
  return [...getGetWalletHermitBalanceQueryKey({ refresh }), walletAddress] as const;
}
