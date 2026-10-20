import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getWalletProfile, saveWalletUsername } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { errorText } from '@/lib/api';
import { readSecure, writeSecure } from '@/lib/storage';
import * as Crypto from 'expo-crypto';
import { RecoveryScreen } from './recovery';
import { Button, Field, Label, Panel, ui } from './ui';
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession(), c = useColors();
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const profile = useQuery({ queryKey: ['mobile', 'profile', session.wallet], queryFn: () => getWalletProfile(), enabled: !!session.wallet, retry: false });
  if (session.loading) return <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}><ActivityIndicator color={c.primary} /></View>;
  if (!session.wallet) return <>{children}</>;
  if (!session.identity) return <RecoveryScreen />;
  if (profile.isLoading) return <ActivityIndicator style={{ flex: 1 }} color={c.primary} />;
  if (!profile.data?.username) return <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: c.background }}>
    <Panel>
      <Text style={[ui.title, { color: c.foreground }]}>Choose your username</Text>
      <Label>4–17 letters, numbers, or underscores. Your wallet remains your sign-in identity.</Label>
      <Field placeholder="Frogtown username" accessibilityLabel="Username" value={name} onChangeText={setName} maxLength={17} />
      <Button title="Save username" disabled={!/^[A-Za-z0-9_]{4,17}$/.test(name)} busy={busy} onPress={() => {
        setBusy(true); setError('');
        void (async () => {
          let deviceId = await readSecure('frogtown.installation');
          if (!deviceId) { deviceId = Crypto.randomUUID(); await writeSecure('frogtown.installation', deviceId); }
          await saveWalletUsername({ username: name, deviceId }); await profile.refetch();
        })().catch((e) => setError(errorText(e))).finally(() => setBusy(false));
      }} />
      {error || profile.error ? <Label>{error || errorText(profile.error)}</Label> : null}
      {profile.error && <Button secondary title="Retry profile" onPress={() => void profile.refetch()} />}
      <Button secondary title="Sign out" onPress={() => void session.signOut().catch((e) => setError(errorText(e)))} />
    </Panel>
  </SafeAreaView>;
  return <>{children}</>;
}
