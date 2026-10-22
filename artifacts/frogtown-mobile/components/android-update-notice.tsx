import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Linking, Platform, Text } from 'react-native';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { androidUpdateCheckUrl, isNewerAndroidRelease, parseAndroidRelease, selectAndroidApk } from '@/lib/android-release';
import { Button, Label, Panel } from './ui';

async function getLatestAndroidRelease() {
  const response = await fetch(androidUpdateCheckUrl, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`Release check returned ${response.status}.`);
  return parseAndroidRelease(await response.json());
}

function apkSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AndroidUpdateNotice() {
  const { wallet } = useSession(), c = useColors();
  const updates = useQuery({
    queryKey: ['mobile', 'android-latest-release'],
    queryFn: getLatestAndroidRelease,
    enabled: Platform.OS === 'android' && Boolean(wallet),
    staleTime: 6 * 60 * 60 * 1000,
    refetchInterval: 12 * 60 * 60 * 1000,
    refetchOnReconnect: true,
    retry: 1,
  });

  if (Platform.OS !== 'android' || !wallet) return null;
  if (updates.isError) return <Panel><Label muted>Frogtown could not check for app updates right now. You can keep using the app.</Label></Panel>;
  const installedVersion = Constants.nativeAppVersion ?? Constants.expoConfig?.version;
  if (!updates.data || !installedVersion || !isNewerAndroidRelease(installedVersion, updates.data.version)) return null;

  const { preferred, universal } = selectAndroidApk(updates.data.assets, Device.supportedCpuArchitectures);
  if (!preferred) return null;
  const installFrom = async (url: string) => {
    try { await Linking.openURL(url); }
    catch { /* Failed URL launches do not affect the current Frogtown session. */ }
  };
  return <Panel style={{ gap: 9 }}>
    <Label><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>Frogtown update available · v{updates.data.version}</Text> (you’re on v{installedVersion})</Label>
    <Button
      title={`Download Android update · ${apkSize(preferred.size)}`}
      onPress={() => void installFrom(preferred.url)}
    />
    {universal && universal.name !== preferred.name && (
      <>
        <Label muted>For devices that cannot install the smaller version, use the universal APK ({apkSize(universal.size)}).</Label>
        <Button secondary title={`Download universal APK · ${apkSize(universal.size)}`} onPress={() => void installFrom(universal.url)} />
      </>
    )}
  </Panel>;
}
