import { useGetWalletHermitTick } from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useColors } from '@/hooks/useColors';

const XRPL_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function HermitHolderStar({ walletAddress, size = 15 }: { walletAddress: string; size?: number }) {
  const c = useColors();
  const query = useGetWalletHermitTick(walletAddress, undefined, {
    query: {
      enabled: XRPL_ADDRESS.test(walletAddress),
      staleTime: 5 * 60 * 1000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });

  const tick = query.data?.checkStatus === 'checked' ? query.data.tick : null;
  if (!tick) return null;

  const gold = tick === 'gold';
  const label = gold ? 'Gold $HERMIT holder star' : 'Green $HERMIT holder star';
  const color = gold ? c.holderGold : c.holderGreen;
  const surface = gold ? c.holderGoldSurface : c.holderGreenSurface;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: size + 4,
        height: size + 4,
        borderRadius: (size + 4) / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: surface,
        borderColor: color,
        borderWidth: 1,
      }}
    >
      <Ionicons name="star" size={size - 4} color={color} />
    </View>
  );
}
