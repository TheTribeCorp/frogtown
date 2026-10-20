import { useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { exportBackup, importBackup, canonicalKey } from '@/lib/crypto';
import { freshIdentity, restoreIdentity } from '@/lib/identity';
import { clearChatState } from '@/lib/outbox';
import { errorText } from '@/lib/api';
import { writeSecure } from '@/lib/storage';
import { Button, Field, Label, Panel, ui } from './ui';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';

export function RecoveryControls() {
  const { wallet, identity, refreshIdentity } = useSession();
  const client = useQueryClient();
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [backup, setBackup] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [exported, setExported] = useState(false);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await operation(); setPassphrase(''); setConfirmation(''); } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  return <Panel>
    <Label>Your private encryption key stays in this phone’s secure storage. Recovery files work with Frogtown on the web too.</Label>
    <Field accessibilityLabel="Recovery passphrase" placeholder="Recovery passphrase (12+ characters to export)" value={passphrase} onChangeText={setPassphrase} secureTextEntry />
    {identity && <Field accessibilityLabel="Confirm new backup passphrase" placeholder="Confirm passphrase for a new backup" value={confirmation} onChangeText={setConfirmation} secureTextEntry />}
    {identity && <Button title="Create and share encrypted backup" busy={busy} disabled={passphrase.length < 12 || passphrase !== confirmation} onPress={() => void run(async () => {
      const text = await exportBackup(wallet, identity, passphrase, Crypto.getRandomBytes);
      const verified = await importBackup(wallet, text, passphrase);
      if (canonicalKey(verified.publicJwk) !== canonicalKey(identity.publicJwk)) throw new Error('The backup did not verify.');
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'frogtown-recovery.json'; anchor.click(); URL.revokeObjectURL(url);
      } else {
        if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this phone.');
        const file = new File(Paths.cache, `frogtown-recovery-${Date.now()}.json`);
        file.create(); file.write(text);
        try { await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your encrypted Frogtown recovery file' }); }
        finally { file.delete(); }
      }
      setExported(true); setMessage('Backup created and verified. Save it somewhere safe, then confirm below. Keep the passphrase separately.');
    })} />}
    {exported && <Button secondary title="I saved my encrypted backup" onPress={() => void run(async () => {
      await writeSecure(`frogtown.backup.${wallet}`, 'saved'); setExported(false); setMessage('Recovery backup confirmed.');
    })} />}
    <Button secondary title="Choose an existing recovery file" disabled={busy} onPress={() => void run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true });
      if (picked.canceled) return;
      if ((picked.assets[0].size ?? 0) > 65536) throw new Error('This recovery file is too large.');
      if (Platform.OS === 'web') {
        const response = await fetch(picked.assets[0].uri); setBackup(await response.text());
      } else {
        const file = new File(picked.assets[0].uri);
        if (file.size > 65536) throw new Error('This recovery file is too large.');
        setBackup(await file.text());
      }
      setMessage('Recovery file loaded. Enter its passphrase and tap Restore.');
    })} />
    <Field accessibilityLabel="Encrypted recovery file JSON" placeholder="Or paste encrypted recovery-file JSON" multiline numberOfLines={3} value={backup} onChangeText={setBackup} maxLength={65536} />
    <Button title="Restore encryption identity" disabled={!backup || !passphrase} busy={busy} onPress={() => void run(async () => {
      await restoreIdentity(wallet, backup, passphrase);
      client.clear(); setBackup(''); await refreshIdentity(); setMessage('Encryption key restored on this device.');
    })} />
    {message ? <Label>{message}</Label> : null}
  </Panel>;
}

export function RecoveryScreen() {
  const c = useColors();
  const session = useSession();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reset = async () => {
    setBusy(true); setError('');
    try {
      client.clear();
      await freshIdentity(session.wallet);
      await clearChatState(session.wallet);
      await writeSecure(`frogtown.backup.${session.wallet}`, 'needed');
      await session.refreshIdentity();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
    <KeyboardAwareScrollViewCompat contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={[ui.title, { color: c.foreground }]}>Your private chats</Text>
      <Label>{session.error || 'Preparing your encryption identity…'}</Label>
      {session.recovery && <RecoveryControls />}
      <Button title="Retry encryption setup" busy={busy} onPress={() => void session.refreshIdentity()} />
      {session.recovery && <Button secondary title="I have no backup — start fresh" busy={busy} onPress={() => {
        const warning = 'This replaces your chat key and clears your access to previous chats across devices. Group memberships stay. Other members’ messages are not deleted. This cannot be undone.';
        if (Platform.OS === 'web') { if (window.confirm(warning)) void reset(); }
        else Alert.alert('Start fresh?', warning, [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear my old chat history', style: 'destructive', onPress: () => void reset() }]);
      }} />}
      {error ? <Label>{error}</Label> : null}
      <Button secondary title="Sign out" onPress={() => void session.signOut().catch((e) => setError(errorText(e)))} />
    </KeyboardAwareScrollViewCompat>
  </SafeAreaView>;
}
