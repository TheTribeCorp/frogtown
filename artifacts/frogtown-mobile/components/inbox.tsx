import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  createDirectConversation,
  createGroupInvite,
  createGroup,
  deleteGroup,
  getGetHermitMarketDataQueryKey,
  getWalletHermitBalance,
  previewGroupInvite,
  joinGroup,
  joinGroupByInvite,
  listConversations,
  listGroups,
  useGetHermitMarketData,
  useListRemovedGroupMembers,
  useRemoveGroupMember,
  useRestoreGroupMember,
  type Conversation,
  type Group,
} from '@workspace/api-client-react';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { errorText, searchWalletUsers } from '@/lib/api';
import { memberSearchTerm } from '@/lib/member-search';
import { isIncomingMessageRequest, splitInboxConversations } from '@/lib/inbox-sections';
import { readSecure } from '@/lib/storage';
import { Button, Field, Label, Panel, ui } from './ui';
import { MobileTimelineScreen } from './mobile-timeline';
import { MobileQuestsScreen } from './mobile-quests';
import { HermitHolderStar } from './hermit-holder-star';
import { AndroidUpdateNotice } from './android-update-notice';

type MainSection = 'chats' | 'groups' | 'timeline' | 'quests';
type ConversationSectionRow = { rowType: 'section'; id: string; title: string; count: number };
type InboxListItem = Conversation | Group | ConversationSectionRow;

const sections: Array<{ id: MainSection; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'chats', label: 'Chats', icon: 'chatbubbles-outline' },
  { id: 'groups', label: 'Groups', icon: 'people-outline' },
  { id: 'timeline', label: 'Timeline', icon: 'newspaper-outline' },
  { id: 'quests', label: 'Daily quests', icon: 'trophy-outline' },
];

function formatMarketCap(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function InboxScreen() {
  const { wallet } = useSession(), c = useColors(), router = useRouter(), client = useQueryClient();
  const routeParams = useLocalSearchParams<{ groupInvite?: string }>();
  const inviteToken = typeof routeParams.groupInvite === 'string' ? routeParams.groupInvite : '';
  const [section, setSection] = useState<MainSection>('chats');
  const [target, setTarget] = useState(''), [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [backupNeeded, setBackupNeeded] = useState(false);
  const [inviteHandled, setInviteHandled] = useState<string | null>(null);
  const isChats = section === 'chats';
  const searchTerm = memberSearchTerm(debouncedSearch);
  const chats = useQuery({ queryKey: ['mobile', 'inbox', wallet], queryFn: () => listConversations({ walletAddress: wallet }), refetchInterval: 3000 });
  const groups = useQuery({ queryKey: ['mobile', 'groups', wallet], queryFn: () => listGroups({ walletAddress: wallet }), refetchInterval: 10_000 });
  const peopleSearch = useQuery({
    queryKey: ['mobile', 'wallet-search', wallet, searchTerm?.toLowerCase()],
    queryFn: () => searchWalletUsers(searchTerm!),
    enabled: isChats && Boolean(searchTerm),
    staleTime: 30_000,
    retry: false,
  });
  const market = useGetHermitMarketData({ query: { queryKey: getGetHermitMarketDataQueryKey(), refetchInterval: 60_000, staleTime: 45_000, retry: 1 } });
  const invitePreview = useQuery({
    queryKey: ['mobile', 'group-invite-preview', inviteToken],
    queryFn: () => previewGroupInvite({ token: inviteToken }),
    enabled: Boolean(inviteToken),
    retry: false,
  });
  // Match the website’s fresh login scan for XRPL wallets; EVM wallets are not XRPL $HERMIT accounts.
  useQuery({
    queryKey: ['mobile', 'hermit-balance', wallet, 'fresh'],
    queryFn: () => getWalletHermitBalance({ refresh: true }),
    enabled: Boolean(wallet && !wallet.toLowerCase().startsWith('0x')),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    retry: 1,
  });
  useEffect(() => { void readSecure(`frogtown.backup.${wallet}`).then((value) => setBackupNeeded(value !== 'saved')); }, [wallet]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const open = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } });
  const openDirect = (conversation: Conversation) => {
    // Seed the destination's inbox before navigating: the old cached list may
    // not contain a just-created request until the next polling cycle.
    client.setQueryData<Conversation[]>(['mobile', 'inbox', wallet], (previous = []) => [
      conversation, ...previous.filter((item) => item.id !== conversation.id),
    ]);
    open(conversation.id);
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); await client.invalidateQueries({ queryKey: ['mobile'] }); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!wallet || !inviteToken || inviteHandled === inviteToken || invitePreview.isLoading) return;
    setInviteHandled(inviteToken);
    router.replace('/');
    if (invitePreview.isError || !invitePreview.data) {
      setError(invitePreview.error ? errorText(invitePreview.error) : 'This invite is invalid or has been revoked.');
      return;
    }
    const preview = invitePreview.data;
    const alreadyJoined = groups.data?.find((group) => group.id === preview.groupId && group.isJoined);
    const detail = `${preview.description || 'A Frogtown encrypted group.'}\n\n${preview.memberCount} members · Created by ${preview.creatorUsername ? `@${preview.creatorUsername}` : `${preview.creatorAddress.slice(0, 8)}…${preview.creatorAddress.slice(-6)}`}.\n\nExisting members’ devices may automatically share older encrypted messages after you join. Frogtown cannot read message contents.`;
    const enter = () => {
      if (alreadyJoined) {
        setSection('groups');
        open(alreadyJoined.conversationId);
        return;
      }
      void run(async () => {
        const group = await joinGroupByInvite({ token: inviteToken, walletAddress: wallet });
        await client.invalidateQueries({ queryKey: ['mobile', 'groups', wallet] });
        await client.invalidateQueries({ queryKey: ['mobile', 'inbox', wallet] });
        setSection('groups');
        open(group.conversationId);
      });
    };
    const title = alreadyJoined ? `Open ${preview.name}?` : `Join ${preview.name}?`;
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${detail}`)) enter();
    } else {
      Alert.alert(title, detail, [
        { text: 'Not now', style: 'cancel' },
        { text: alreadyJoined ? 'Open group' : 'Join group', onPress: enter },
      ]);
    }
  }, [wallet, inviteToken, inviteHandled, invitePreview.isLoading, invitePreview.isError, invitePreview.data, invitePreview.error, groups.data]);
  const visibleChats = useMemo(() => (chats.data ?? []).filter((item) => `${item.title} ${item.type} ${item.otherWalletAddress ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())), [chats.data, search]);
  const visibleGroups = useMemo(() => (groups.data ?? []).filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase())), [groups.data, search]);
  const currentQuery = isChats ? chats : groups;
  const selectedItems = useMemo<InboxListItem[]>(() => {
    if (!isChats) return visibleGroups;
    const { unread, read } = splitInboxConversations(visibleChats, wallet);
    const rows: InboxListItem[] = [];
    if (unread.length > 0) rows.push(
      { rowType: 'section', id: 'unread-messages-section', title: 'Unread messages', count: unread.length },
      ...unread,
    );
    if (read.length > 0) rows.push(
      { rowType: 'section', id: 'read-messages-section', title: 'Read messages', count: read.length },
      ...read,
    );
    return rows;
  }, [isChats, visibleChats, visibleGroups, chats.data, wallet]);

  return <SafeAreaView style={[{ flex: 1, backgroundColor: c.background }, Platform.OS === 'web' && { paddingTop: 67, paddingBottom: 34 }]}>
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, gap: 10 }}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <View><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.3 }}>FROGTOWN · $HERMIT COMMUNITY</Text><Text style={[ui.title, { color: c.foreground, fontSize: 25 }]}>{sections.find((item) => item.id === section)?.label}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={{ padding: 10 }}><Ionicons name="settings-outline" size={22} color={c.primary} /></Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: c.mutedForeground, fontSize: 10, letterSpacing: 1, fontFamily: 'Inter_600SemiBold' }}>$HERMIT MARKET CAP</Text>
          <Text accessibilityLabel={`$HERMIT market cap ${formatMarketCap(market.data?.marketCapUsd)}`} style={{ color: c.primary, fontFamily: 'Inter_700Bold', fontSize: 15 }}>{formatMarketCap(market.data?.marketCapUsd)}</Text>
        </View>
      </View>
      {section === 'timeline' ? <MobileTimelineScreen walletAddress={wallet} /> : section === 'quests' ? <MobileQuestsScreen walletAddress={wallet} onNavigate={setSection} /> : <FlatList<InboxListItem>
        style={{ flex: 1 }}
        data={selectedItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshing={currentQuery.isRefetching}
        onRefresh={() => void currentQuery.refetch()}
        ListHeaderComponent={<View style={{ gap: 12, marginBottom: 8 }}>
          <AndroidUpdateNotice />
          {backupNeeded && isChats && <Panel><Label>Keep your chats recoverable. Create an encrypted backup for this phone.</Label><Button secondary title="Create my recovery backup" onPress={() => router.push('/settings')} /></Panel>}
          <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 24, paddingHorizontal: 12 }}>
            <Ionicons name="search" size={18} color={c.mutedForeground} />
            <Field accessibilityLabel={isChats ? 'Search people or chats' : 'Search groups'} placeholder={isChats ? 'Find users or chats' : 'Find groups by name or description'} value={search} onChangeText={setSearch} style={{ flex: 1, minHeight: 46, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 9 }} />
            {search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={{ padding: 6 }}><Ionicons name="close-circle" size={18} color={c.mutedForeground} /></Pressable>}
          </View>
          {isChats && search.trim().length > 0 && !memberSearchTerm(search) && <Label muted>Find members with 4–17 letters, numbers, or underscores, or paste a complete wallet address. Existing chats are still filtered below.</Label>}
          {isChats && searchTerm && <Panel style={{ gap: 10 }}>
            <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>People</Text>
            {peopleSearch.isFetching && <ActivityIndicator color={c.primary} />}
            {peopleSearch.error && <Label muted>{errorText(peopleSearch.error)}</Label>}
            {peopleSearch.data?.map((person) => <View key={person.walletAddress} style={[ui.row, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 9 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>{person.username ? `@${person.username}` : `${person.walletAddress.slice(0, 8)}…${person.walletAddress.slice(-6)}`}</Text>
                  <HermitHolderStar walletAddress={person.walletAddress} size={14} />
                </View>
                <Label muted>{`${person.walletAddress.slice(0, 8)}…${person.walletAddress.slice(-6)}`}</Label>
              </View>
              <Button secondary title="Message" busy={busy} onPress={() => void run(async () => {
                const chat = await createDirectConversation({ fromWalletAddress: wallet, recipient: person.walletAddress });
                setSearch('');
                setTarget('');
                openDirect(chat);
              })} />
            </View>)}
            {!peopleSearch.isFetching && !peopleSearch.error && peopleSearch.data?.length === 0 && <Label muted>No matching users. You can still message an exact wallet address below.</Label>}
          </Panel>}
          <Panel>
            <Label>{isChats ? 'Message by username or wallet address' : 'Create a new community group'}</Label>
            <Field accessibilityLabel={isChats ? 'Username or wallet address' : 'Group name'} placeholder={isChats ? '@username or wallet address' : 'Group name'} value={target} onChangeText={setTarget} maxLength={isChats ? 43 : 60} />
            {!isChats && <Field placeholder="Group description" accessibilityLabel="Group description" value={description} onChangeText={setDescription} maxLength={500} />}
            <Button title={isChats ? 'Open private chat' : 'Create group'} busy={busy} disabled={isChats ? !memberSearchTerm(target) : target.trim().length < 2} onPress={() => void run(async () => {
              if (isChats) {
                const chat = await createDirectConversation({ fromWalletAddress: wallet, recipient: target.trim().replace(/^@/, '') });
                setTarget(''); openDirect(chat);
              } else {
                const group = await createGroup({ creatorAddress: wallet, name: target.trim(), description: description.trim() });
                setTarget(''); setDescription(''); open(group.conversationId);
              }
            })} />
            {!!error && <Label>{error}</Label>}
          </Panel>
          {currentQuery.error ? <Label>{errorText(currentQuery.error)}</Label> : null}
        </View>}
        ListEmptyComponent={currentQuery.isLoading ? <ActivityIndicator color={c.primary} /> : <Panel><Label>{isChats ? 'No chats yet. Start with a username or join a group.' : 'No public groups match. Create the first one.'}</Label></Panel>}
        renderItem={({ item }) => {
          if ('rowType' in item) return <View testID={`section-${item.id}`} style={{ paddingTop: 4, paddingBottom: 1 }}>
            <Text style={{ color: item.id.startsWith('unread') ? c.primary : c.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>{item.title} · {item.count}</Text>
          </View>;
          if ('isJoined' in item) return <Panel>
            <Text style={[ui.subtitle, { color: c.foreground }]}>{item.name}</Text>
            <Label muted>{item.description || 'A community room'} · {item.memberCount} members</Label>
            <Button secondary title={item.isJoined ? 'Open group' : item.canJoin ? 'Join group' : 'Access removed'} disabled={!item.isJoined && !item.canJoin} busy={busy} onPress={() => {
              if (item.isJoined) open(item.conversationId);
              else void run(async () => { const joined = await joinGroup(item.id, { walletAddress: wallet }); open(joined.conversationId); });
            }} />
            {item.canManage && <View style={{ gap: 8 }}>
              <Button secondary title="Share invite link" busy={busy} onPress={() => void run(async () => {
                const invite = await createGroupInvite(item.id);
                const link = `https://www.frogtown.online/?groupInvite=${encodeURIComponent(invite.token)}`;
                await Share.share({ message: `Join ${item.name} on Frogtown: ${link}\n\nOpen in Frogtown Mobile: frogtown://?groupInvite=${encodeURIComponent(invite.token)}` });
              })} />
              <Button secondary title="Delete group and history" busy={busy} onPress={() => {
                const remove = () => void run(async () => { await deleteGroup(item.id); await client.invalidateQueries({ queryKey: ['mobile'] }); });
                const message = `Permanently delete “${item.name}” and all group messages and shared encrypted history? This cannot be undone.`;
                if (Platform.OS === 'web') { if (window.confirm(message)) remove(); }
                else Alert.alert('Delete group permanently?', message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete group', style: 'destructive', onPress: remove }]);
              }} />
            </View>}
          </Panel>;
          const incomingRequest = isIncomingMessageRequest(item, wallet);
          return <Pressable accessibilityRole="button" accessibilityLabel={`${incomingRequest ? 'Review new message request from' : 'Open'} ${item.title}`} onPress={() => open(item.id)}>
            <Panel>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                 <Text style={[ui.subtitle, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>{item.title}</Text>
                 {item.type === 'direct' && item.otherWalletAddress ? <HermitHolderStar walletAddress={item.otherWalletAddress} size={15} /> : null}
                {(item.unreadCount > 0 || incomingRequest) && <View style={{ backgroundColor: c.primary, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 16 }}><Text style={{ color: c.primaryForeground, fontSize: 10 }}>{item.unreadCount > 0 ? item.unreadCount : 'NEW'}</Text></View>}
              </View>
              <Label muted>{item.directStatus === 'pending' ? (item.requesterAddress === wallet ? 'Waiting for request approval' : 'New private-message request · Tap to review') : item.type === 'group' ? `${item.memberCount} members · Encrypted group` : 'Private · End-to-end encrypted'}</Label>
            </Panel>
          </Pressable>;
        }}
      />}
    </View>
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, paddingHorizontal: 4, paddingTop: 6 }}>
      {sections.map((item) => {
        const active = item.id === section;
        return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label} onPress={() => { setSection(item.id); setSearch(''); setError(''); setTarget(''); }} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          <Ionicons name={item.icon} size={21} color={active ? c.primary : c.mutedForeground} />
          <Text numberOfLines={1} style={{ color: active ? c.primary : c.mutedForeground, fontSize: 10, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular' }}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
  </SafeAreaView>;
}
