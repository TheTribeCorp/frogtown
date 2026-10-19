import { Star } from 'lucide-react';
import { useGetWalletHermitTick, getGetWalletHermitTickQueryKey } from '@workspace/api-client-react';
import { visibleHermitTick } from '@/lib/hermit-tick-display';

type HermitTickProps = {
  walletAddress: string;
  currentWallet?: boolean;
  className?: string;
};

export function HermitTick({ walletAddress, currentWallet = false, className = '' }: HermitTickProps) {
  const params = currentWallet ? { refresh: true } : undefined;
  const query = useGetWalletHermitTick(walletAddress, params, {
    query: {
      enabled: Boolean(walletAddress) && !walletAddress.toLowerCase().startsWith('0x'),
      queryKey: getGetWalletHermitTickQueryKey(walletAddress, params),
      staleTime: currentWallet ? 0 : 5 * 60 * 1000,
      retry: false,
      ...(currentWallet ? { refetchOnMount: 'always' as const } : {}),
    },
    request: { credentials: 'same-origin' },
  });
  const tick = visibleHermitTick(query.data, query.isError);
  if (!tick) return null;

  const label = tick === 'gold'
    ? 'Gold $HERMIT holder verification star'
    : 'Green $HERMIT holder verification star';
  return (
    <span
      className={`hermit-tick hermit-tick-${tick} ${className}`}
      role="img"
      aria-label={label}
      title={label}
      data-testid={`hermit-tick-${tick}`}
    >
      <Star aria-hidden="true" focusable="false" />
    </span>
  );
}
