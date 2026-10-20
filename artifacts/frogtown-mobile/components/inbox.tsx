import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createDirectConversation, createGroup, joinGroup, listConversations, listGroups, type Conversation, type Group } from '@workspace/api-client-react';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { errorText } from '@/lib/api';
import { readSecure } from '@/lib/storage';
import { Button, Field, Label, Panel, ui } from './ui';

export function InboxScreen() {
  const { wallet } = useSession(), c = useColors(), router = useRouter(), client = useQueryClient();
  const [tab, setTab] = useState<'chats' | 'groups'>('chats');
  const [target, setTarget] = useState(''), [description, setDescription] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [backupNeeded, setBackupNeeded] = useState(false);
  const chats = useQuery({ queryKey: ['mobile', 'inbox', wallet], queryFn: () => listConversations({ walletAddress: wallet }), refetchInterval: 3000 });
  const groups = useQuery({ queryKey: ['mobile', 'groups', wallet], queryFn: () => listGroups({ walletAddress: wallet }), refetchInterval: 10_000 });
  useEffect(() => { void readSecure(`frogtown.backup.${wallet}`).then((value) => setBackupNeeded(value !== 'saved')); }, [wallet]);
  const open = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } });
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); await client.invalidateQueries({ queryKey: ['mobile'] }); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
    <View style={{ padding: 20, gap: 12 }}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={[ui.title, { color: c.foreground }]}>Frogtown</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={{ padding: 12 }}><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>Settings</Text></Pressable>
      </View>
      <View style={ui.row}>
        <View style={{ flex: 1 }}><Button title="Chats" secondary={tab !== 'chats'} onPress={() => { setTab('chats'); setTarget(''); setError(''); }} /></View>
        <View style={{ flex: 1 }}><Button title="Discover groups" secondary={tab !== 'groups'} onPress={() => { setTab('groups'); setTarget(''); setError(''); }} /></View>
      </View>
    </View>
    <FlatList<Conversation | Group>
      data={tab === 'chats' ? chats.data ?? [] : groups.data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      refreshing={tab === 'chats' ? chats.isRefetching : groups.isRefetching}
      onRefresh={() => void (tab === 'chats' ? chats.refetch() : groups.refetch())}
      ListHeaderComponent={<View style={{ gap: 12, marginBottom: 12 }}>
        {backupNeeded && <Panel><Label>Keep your chats recoverable. Create an encrypted backup for this phone.</Label><Button secondary title="Create my recovery backup" onPress={() => router.push('/settings')} /></Panel>}
        <Panel>
          <Label>{tab === 'chats' ? 'Start a private-message request' : 'Create a new community group'}</Label>
          <Field accessibilityLabel={tab === 'chats' ? 'Username or wallet address' : 'Group name'} placeholder={tab === 'chats' ? '@username or wallet address' : 'Group name'} value={target} onChangeText={setTarget} maxLength={tab === 'chats' ? 43 : 60} />
          {tab === 'groups' && <Field placeholder="Group description" accessibilityLabel="Group description" value={description} onChangeText={setDescription} maxLength={500} />}
          <Button title={tab === 'chats' ? 'Open private chat' : 'Create group'} busy={busy} disabled={target.trim().length < (tab === 'chats' ? 4 : 2)} onPress={() => void run(async () => {
            if (tab === 'chats') {
              const chat = await createDirectConversation({ fromWalletAddress: wallet, recipient: target.trim().replace(/^@/, '') });
              setTarget(''); open(chat.id);
            } else {
              const group = await createGroup({ creatorAddress: wallet, name: target.trim(), description: description.trim() });
              setTarget(''); setDescription(''); open(group.conversationId);
            }
          })} />
          {!!error && <Label>{error}</Label>}
        </Panel>
        {(tab === 'chats' ? chats.error : groups.error) ? <Label>{errorText(tab === 'chats' ? chats.error : groups.error)}</Label> : null}
      </View>}
      ListEmptyComponent={chats.isLoading || groups.isLoading ? <ActivityIndicator color={c.primary} /> : <Panel><Label>{tab === 'chats' ? 'No chats yet. Start with a username or join a group.' : 'No public groups yet. Create the first one.'}</Label></Panel>}
      renderItem={({ item }) => {
        if ('isJoined' in item) return <Panel>
          <Text style={[ui.subtitle, { color: c.foreground }]}>{item.name}</Text>
          <Label muted>{item.description} · {item.memberCount} members</Label>
          <Button secondary title={item.isJoined ? 'Open group' : 'Join group'} busy={busy} onPress={() => {
            if (item.isJoined) open(item.conversationId);
            else void run(async () => { const joined = await joinGroup(item.id, { walletAddress: wallet }); open(joined.conversationId); });
          }} />
        </Panel>;
        return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => open(item.id)}>
          <Panel>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.subtitle, { color: c.foreground, flex: 1 }]} numberOfLines={1}>{item.title}</Text>
              {item.unreadCount > 0 && <View style={{ backgroundColor: c.primary, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 16 }}><Text style={{ color: c.primaryForeground }}>{item.unreadCount}</Text></View>}
            </View>
            <Label muted>{item.directStatus === 'pending' ? (item.requesterAddress === wallet ? 'Waiting for request approval' : 'New private-message request') : item.type === 'group' ? `${item.memberCount} members · Encrypted group` : 'Private · End-to-end encrypted'}</Label>
          </Panel>
        </Pressable>;
      }}
    />
  </SafeAreaView>;
}
