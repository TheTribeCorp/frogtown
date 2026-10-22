import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  createDirectConversation,
  createGroup,
  getGetHermitMarketDataQueryKey,
  getWalletHermitBalance,
  joinGroup,
  listConversations,
  listGroups,
  useGetHermitMarketData,
  type Conversation,
  type Group,
} from '@workspace/api-client-react';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { errorText, searchWalletUsers } from '@/lib/api';
import { readSecure } from '@/lib/storage';
import { Button, Field, Label, Panel, ui } from './ui';
import { MobileTimelineScreen } from './mobile-timeline';
import { MobileQuestsScreen } from './mobile-quests';
import { HermitHolderStar } from './hermit-holder-star';

type MainSection = 'chats' | 'groups' | 'timeline' | 'quests';

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
  const [section, setSection] = useState<MainSection>('chats');
  const [target, setTarget] = useState(''), [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [backupNeeded, setBackupNeeded] = useState(false);
  const isChats = section === 'chats';
  const searchTerm = debouncedSearch.trim();
  const normalizedSearchTerm = searchTerm.replace(/^@/, '');
  const chats = useQuery({ queryKey: ['mobile', 'inbox', wallet], queryFn: () => listConversations({ walletAddress: wallet }), refetchInterval: 3000 });
  const groups = useQuery({ queryKey: ['mobile', 'groups', wallet], queryFn: () => listGroups({ walletAddress: wallet }), refetchInterval: 10_000 });
  const peopleSearch = useQuery({
    queryKey: ['mobile', 'wallet-search', wallet, searchTerm.toLowerCase()],
    queryFn: () => searchWalletUsers(searchTerm),
    enabled: isChats && normalizedSearchTerm.length >= 4,
    staleTime: 30_000,
    retry: false,
  });
  const market = useGetHermitMarketData({ query: { queryKey: getGetHermitMarketDataQueryKey(), refetchInterval: 60_000, staleTime: 45_000, retry: 1 } });
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
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); await client.invalidateQueries({ queryKey: ['mobile'] }); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const visibleChats = useMemo(() => (chats.data ?? []).filter((item) => `${item.title} ${item.type} ${item.otherWalletAddress ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())), [chats.data, search]);
  const visibleGroups = useMemo(() => (groups.data ?? []).filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase())), [groups.data, search]);
  const currentQuery = isChats ? chats : groups;
  const selectedItems = isChats ? visibleChats : visibleGroups;

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
      {section === 'timeline' ? <MobileTimelineScreen walletAddress={wallet} /> : section === 'quests' ? <MobileQuestsScreen walletAddress={wallet} onNavigate={setSection} /> : <FlatList<Conversation | Group>
        style={{ flex: 1 }}
        data={selectedItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshing={currentQuery.isRefetching}
        onRefresh={() => void currentQuery.refetch()}
        ListHeaderComponent={<View style={{ gap: 12, marginBottom: 8 }}>
          {backupNeeded && isChats && <Panel><Label>Keep your chats recoverable. Create an encrypted backup for this phone.</Label><Button secondary title="Create my recovery backup" onPress={() => router.push('/settings')} /></Panel>}
          <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 24, paddingHorizontal: 12 }}>
            <Ionicons name="search" size={18} color={c.mutedForeground} />
            <Field accessibilityLabel={isChats ? 'Search people or chats' : 'Search groups'} placeholder={isChats ? 'Find users or chats' : 'Find groups by name or description'} value={search} onChangeText={setSearch} style={{ flex: 1, minHeight: 46, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 9 }} />
            {search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={{ padding: 6 }}><Ionicons name="close-circle" size={18} color={c.mutedForeground} /></Pressable>}
          </View>
          {isChats && normalizedSearchTerm.length >= 4 && <Panel style={{ gap: 10 }}>
            <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>People</Text>
            {peopleSearch.isFetching && <ActivityIndicator color={c.primary} />}
            {peopleSearch.error && <Label muted>{errorText(peopleSearch.error)}</Label>}
            {peopleSearch.data?.map((person) => <View key={person.walletAddress} style={[ui.row, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 9 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>@{person.username}</Text>
                  <HermitHolderStar walletAddress={person.walletAddress} size={14} />
                </View>
                <Label muted>{`${person.walletAddress.slice(0, 8)}…${person.walletAddress.slice(-6)}`}</Label>
              </View>
              <Button secondary title="Message" busy={busy} onPress={() => void run(async () => {
                const chat = await createDirectConversation({ fromWalletAddress: wallet, recipient: person.walletAddress });
                setSearch('');
                setTarget('');
                open(chat.id);
              })} />
            </View>)}
            {!peopleSearch.isFetching && !peopleSearch.error && peopleSearch.data?.length === 0 && <Label muted>No matching users. You can still message an exact wallet address below.</Label>}
          </Panel>}
          <Panel>
            <Label>{isChats ? 'Message by username or wallet address' : 'Create a new community group'}</Label>
            <Field accessibilityLabel={isChats ? 'Username or wallet address' : 'Group name'} placeholder={isChats ? '@username or wallet address' : 'Group name'} value={target} onChangeText={setTarget} maxLength={isChats ? 43 : 60} />
            {!isChats && <Field placeholder="Group description" accessibilityLabel="Group description" value={description} onChangeText={setDescription} maxLength={500} />}
            <Button title={isChats ? 'Open private chat' : 'Create group'} busy={busy} disabled={target.trim().length < (isChats ? 4 : 2)} onPress={() => void run(async () => {
              if (isChats) {
                const chat = await createDirectConversation({ fromWalletAddress: wallet, recipient: target.trim().replace(/^@/, '') });
                setTarget(''); open(chat.id);
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
          if ('isJoined' in item) return <Panel>
            <Text style={[ui.subtitle, { color: c.foreground }]}>{item.name}</Text>
            <Label muted>{item.description || 'A community room'} · {item.memberCount} members</Label>
            <Button secondary title={item.isJoined ? 'Open group' : 'Join group'} busy={busy} onPress={() => {
              if (item.isJoined) open(item.conversationId);
              else void run(async () => { const joined = await joinGroup(item.id, { walletAddress: wallet }); open(joined.conversationId); });
            }} />
          </Panel>;
          return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => open(item.id)}>
            <Panel>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                 <Text style={[ui.subtitle, { color: c.foreground, flexShrink: 1 }]} numberOfLines={1}>{item.title}</Text>
                 {item.type === 'direct' && item.otherWalletAddress ? <HermitHolderStar walletAddress={item.otherWalletAddress} size={15} /> : null}
                {item.unreadCount > 0 && <View style={{ backgroundColor: c.primary, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 16 }}><Text style={{ color: c.primaryForeground }}>{item.unreadCount}</Text></View>}
              </View>
              <Label muted>{item.directStatus === 'pending' ? (item.requesterAddress === wallet ? 'Waiting for request approval' : 'New private-message request') : item.type === 'group' ? `${item.memberCount} members · Encrypted group` : 'Private · End-to-end encrypted'}</Label>
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
