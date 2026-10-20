import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMobilePushDevices, revokeMobilePushDevice, getWalletProfile, saveWalletUsername, listBlockedWallets, unblockWallet } from '@workspace/api-client-react';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { errorText } from '@/lib/api';
import { readSecure, removeSecure } from '@/lib/storage';
import { RecoveryControls } from '@/components/recovery';
import { Button, Field, Label, Panel, ui } from '@/components/ui';
import { SessionGate } from '@/components/session-gate';

function SettingsContent() {
  const session = useSession(), c = useColors(), router = useRouter(), client = useQueryClient();
  const { wallet } = session;
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [username, setUsername] = useState('');
  const devices = useQuery({ queryKey: ['mobile', 'devices', wallet], queryFn: () => listMobilePushDevices(), enabled: !!wallet });
  const profile = useQuery({ queryKey: ['mobile', 'profile', wallet], queryFn: () => getWalletProfile(), enabled: !!wallet });
  const blocked = useQuery({ queryKey: ['mobile', 'blocked', wallet], queryFn: () => listBlockedWallets(), enabled: !!wallet });
  useEffect(() => { void readSecure(`frogtown.push.${wallet}`).then(setDeviceId); }, [wallet]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    await revokeMobilePushDevice(id);
    if (id === deviceId) { await removeSecure(`frogtown.push.${wallet}`); setDeviceId(null); }
    await devices.refetch();
  };
  if (!wallet) return <Redirect href="/" />;
  const enabled = !!deviceId && !!devices.data?.some((d) => d.id === deviceId);
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Button secondary title="‹ Back to chats" onPress={() => router.replace('/')} />
      <Text style={[ui.title, { color: c.foreground }]}>Your Frogtown</Text>
      <Panel>
        <Text style={[ui.subtitle, { color: c.foreground }]}>{profile.data?.username ? `@${profile.data.username}` : 'Your account'}</Text>
        <Label muted>{wallet}</Label>
        <Field accessibilityLabel="New username" placeholder="New username (4–17 characters)" value={username} onChangeText={setUsername} maxLength={17} />
        <Button title="Update username" busy={busy} disabled={!/^[A-Za-z0-9_]{4,17}$/.test(username)} onPress={() => void run(async () => {
          await saveWalletUsername({ username }); setUsername(''); await client.invalidateQueries({ queryKey: ['mobile'] });
        })} />
      </Panel>
      <Panel>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <Text style={[ui.subtitle, { color: c.foreground, flex: 1 }]}>New-message alerts</Text>
          <Switch accessibilityLabel="Enable message alerts on this phone" value={enabled} disabled={busy} trackColor={{ true: c.primary, false: c.border }} onValueChange={(value) => void run(async () => {
            if (value) {
              // Guard before importing native notification code: the web
              // preview cannot load or enroll native notification modules.
              if (Platform.OS === 'web') {
                throw new Error('Message alerts require an installed, push-configured iPhone or Android build on a physical phone. They are not available in this browser preview.');
              }
              const { enableMessageAlerts } = await import('@/lib/notifications');
              setDeviceId(await enableMessageAlerts(wallet)); await devices.refetch();
            } else if (deviceId) await revoke(deviceId);
          })} />
        </View>
        <Label muted>Private and group messages can alert you while Frogtown is closed. Alerts never contain message text. Apple/Google notification services may process device tokens and opaque conversation identifiers.</Label>
        <Label muted>Remote alerts require an installed, push-configured native build and a physical phone. They are not supported by Expo Go or this web preview.</Label>
        {Platform.OS !== 'web' && <Button secondary title="Open phone notification settings" onPress={() => void Linking.openSettings().catch((e) => setError(errorText(e)))} />}
        {devices.error && <Label>{errorText(devices.error)}</Label>}
        {devices.data?.map((device) => <View key={device.id} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 8 }}>
          <Label>{device.name}{device.id === deviceId ? ' · This phone' : ''}</Label>
          <Label muted>Last registered {new Date(device.updatedAt).toLocaleDateString()}</Label>
          <Button secondary title={`Revoke ${device.name}`} busy={busy} onPress={() => void run(() => revoke(device.id))} />
        </View>)}
        <Button secondary title="Refresh notification devices" onPress={() => void devices.refetch()} />
      </Panel>
      <Text style={[ui.subtitle, { color: c.foreground }]}>Chat recovery</Text>
      <RecoveryControls />
      <Panel>
        <Text style={[ui.subtitle, { color: c.foreground }]}>Blocked wallets</Text>
        {blocked.data?.length === 0 && <Label muted>No wallets blocked.</Label>}
        {blocked.error && <Label>{errorText(blocked.error)}</Label>}
        {blocked.data?.map((item) => <View key={item.blockedWalletAddress} style={{ gap: 8 }}>
          <Label>{item.blockedWalletAddress}</Label>
          <Button secondary title="Unblock this wallet" busy={busy} onPress={() => void run(async () => { await unblockWallet(item.blockedWalletAddress); await blocked.refetch(); })} />
        </View>)}
      </Panel>
      {!!error && <Label>{error}</Label>}
      <Button title="Sign out and disable this phone’s alerts" busy={busy} onPress={() => void run(async () => { await session.signOut(); router.replace('/'); })} />
    </ScrollView>
  </SafeAreaView>;
}

export default function SettingsScreen() {
  return <SessionGate><SettingsContent /></SessionGate>;
}
