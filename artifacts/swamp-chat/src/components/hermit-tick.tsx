import { useGetWalletHermitTick, getGetWalletHermitTickQueryKey } from '@workspace/api-client-react';

type HermitTickProps = {
  walletAddress: string;
  currentWallet?: boolean;
  className?: string;
};

export function HermitTick({ walletAddress, currentWallet = false, className = '' }: HermitTickProps) {
  const params = currentWallet ? { refresh: true } : undefined;
  const query = useGetWalletHermitTick(walletAddress, params, {
    query: {
      enabled: Boolean(walletAddress),
      queryKey: getGetWalletHermitTickQueryKey(walletAddress, params),
      staleTime: currentWallet ? 0 : 5 * 60 * 1000,
      ...(currentWallet ? { refetchOnMount: 'always' as const } : {}),
    },
  });

  const tick = !query.isFetching && !query.isError && query.data?.checkStatus === 'checked'
    ? query.data.tick
    : null;
  if (!tick) return null;

  const label = tick === 'gold' ? 'Gold $HERMIT holder' : 'Green $HERMIT holder';
  return (
    <span
      className={`hermit-tick hermit-tick-${tick} ${className}`}
      role="img"
      aria-label={label}
      title={label}
      data-testid={`hermit-tick-${tick}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="m4.2 8.2 2.35 2.35 5.25-5.3" />
      </svg>
    </span>
  );
}
