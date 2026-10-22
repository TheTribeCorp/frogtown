import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Platform, Pressable, Text, View, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  acceptConversationRequest, declineConversationRequest, blockWallet,
  deleteGroupMessage, getConversationEncryptionKeys, listConversations, listRemovedGroupMembers, markConversationRead,
  removeGroupMember as removeGroupMemberRequest, restoreGroupMember, sendMessage,
} from '@workspace/api-client-react';
import { useSession } from '@/providers/session';
import { useColors } from '@/hooks/useColors';
import { HermitHolderStar } from '@/components/hermit-holder-star';
import { encryptMessage, safetyCode } from '@/lib/crypto';
import { loadChat, shareGroupHistory, trustKeys } from '@/lib/chat';
import { ensureIdentity, RecoveryRequired } from '@/lib/identity';
import { loadOutbox, savePending, removePending, removeConversationPending, type PendingMessage } from '@/lib/outbox';
import { errorText } from '@/lib/api';
import { Button, Field, Label, ui } from '@/components/ui';
import { SessionGate } from '@/components/session-gate';

function ChatContent() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const session = useSession(), c = useColors(), client = useQueryClient(), router = useRouter();
  const { wallet, identity } = session;
  const [focused, setFocused] = useState(true);
  const [text, setText] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<PendingMessage | null>(null);
  const [showSafety, setShowSafety] = useState(false), [showMembers, setShowMembers] = useState(false);
  const readPosition = useRef('');
  const focusedRef = useRef(true);
  focusedRef.current = focused;
  const viewability = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const inbox = useQuery({ queryKey: ['mobile', 'inbox', wallet], queryFn: () => listConversations({ walletAddress: wallet }), enabled: !!wallet, refetchInterval: 3000 });
  const conversation = inbox.data?.find((item) => item.id === id);
  const group = conversation?.type === 'group';
  const removedMembers = useQuery({
    queryKey: ['mobile', 'removed-group-members', wallet, id],
    queryFn: () => listRemovedGroupMembers(id),
    enabled: Boolean(wallet && group && conversation?.canManageGroup),
  });
  useEffect(() => {
    // A cached inbox can predate a newly created conversation. Only revoke
    // access after a successful fresh response, never while a refetch is pending.
    if (!inbox.isFetchedAfterMount || inbox.isFetching || inbox.isError || conversation) return;
    void client.removeQueries({ queryKey: ['mobile', 'messages', wallet, id] });
    void client.removeQueries({ queryKey: ['mobile', 'removed-group-members', wallet, id] });
    void removeConversationPending(wallet, id).catch(() => {});
    router.replace('/');
  }, [inbox.isFetchedAfterMount, inbox.isFetching, inbox.isError, conversation, router, client, wallet, id]);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const chat = useQuery({
    queryKey: ['mobile', 'messages', wallet, id],
    queryFn: async () => {
      try { return await loadChat(wallet, id, identity!, group); }
      catch (cause) { if (cause instanceof RecoveryRequired) void session.refreshIdentity(); throw cause; }
    },
    enabled: !!wallet && !!identity && !!conversation && focused, refetchInterval: 3000, retry: false,
  });
  useEffect(() => {
    let active = true;
    void loadOutbox(wallet).then((all) => { if (active) setPending(all.find((p) => p.conversationId === id) ?? null); }).catch((e) => setError(errorText(e)));
    return () => { active = false; };
  }, [wallet, id]);
  useEffect(() => {
    if (!group || !focused || !identity || !chat.data || chat.data.changed.length || chat.isFetching) return;
    void shareGroupHistory(wallet, id, identity, chat.data.keys).catch((e) => setError(`History sharing paused: ${errorText(e)}`));
  }, [chat.dataUpdatedAt, group, focused, wallet, id, identity]);
  useEffect(() => {
    if (pending && chat.data?.rows.some((row) => row.id === pending.messageId)) {
      void removePending(wallet, pending.messageId).then(() => setPending(null)).catch((e) => setError(errorText(e)));
    }
  }, [chat.dataUpdatedAt, pending, wallet]);
  const send = async (retry = false) => {
    if (busy || !identity || !conversation) return;
    setBusy(true); setError('');
    try {
      const latestIdentity = await ensureIdentity(wallet);
      const keys = await getConversationEncryptionKeys(id);
      // Re-fetch trust at send time, so a key change between polls cannot be silently accepted.
      const verified = await loadChat(wallet, id, latestIdentity, group);
      if (verified.changed.length) { await chat.refetch(); throw new Error('A member’s encryption key changed. Verify and trust it before sending.'); }
      let record = pending;
      if (!retry) {
        if (!text.trim()) return;
        if (pending) throw new Error('Retry or discard your pending message first.');
        record = {
          conversationId: id, messageId: Crypto.randomUUID(), createdAt: new Date().toISOString(),
          keyDigest: safetyCode(keys),
          encryptedBody: encryptMessage(text.trim(), id, wallet, latestIdentity, keys, Crypto.getRandomBytes, group),
        };
        await savePending(wallet, record);
        setPending(record); setText('');
      }
      if (!record) return;
      if (record.keyDigest !== safetyCode(keys)) throw new Error('Member encryption keys changed since this retry was saved. Discard the retry copy and compose a new message.');
      await sendMessage(id, { messageId: record.messageId, senderAddress: wallet, body: record.encryptedBody });
      await removePending(wallet, record.messageId); setPending(null);
      await Promise.all([chat.refetch(), client.invalidateQueries({ queryKey: ['mobile', 'inbox', wallet] })]);
    } catch (cause) {
      if (cause instanceof RecoveryRequired) await session.refreshIdentity();
      setError(`${errorText(cause)}${pending ? ' Your encrypted retry copy is still safe.' : ''}`);
    } finally { setBusy(false); }
  };
  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await inbox.refetch(); await chat.refetch(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const removeGroupMessage = (messageId: string) => {
    if (!group || !conversation?.canManageGroup) return;
    const remove = () => void action(async () => { await deleteGroupMessage(id, messageId); });
    const prompt = 'Delete this message for everyone in the group? Any encrypted history copies will also be removed.';
    if (Platform.OS === 'web') { if (window.confirm(prompt)) remove(); }
    else Alert.alert('Delete group message?', prompt, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: remove }]);
  };
  const removeMember = (memberWalletAddress: string) => {
    if (!group || !conversation?.canManageGroup) return;
    const prompt = 'Remove this wallet from the group? They will lose server access and be blocked from rejoining until restored. Messages or decrypted text already saved on their device cannot be erased.';
    const remove = () => void action(async () => {
      await removeGroupMemberRequest(id, memberWalletAddress);
      await removedMembers.refetch();
    });
    if (Platform.OS === 'web') { if (window.confirm(prompt)) remove(); }
    else Alert.alert('Remove group member?', prompt, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: remove }]);
  };
  const restoreMember = (memberWalletAddress: string) => {
    if (!group || !conversation?.canManageGroup) return;
    void action(async () => {
      await restoreGroupMember(id, memberWalletAddress);
      await removedMembers.refetch();
    });
  };
  const onVisible = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = viewableItems.map((v) => v.item).filter((m) => m?.readable).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))[0];
    if (!visible || !focusedRef.current || AppState.currentState !== 'active' || readPosition.current === visible.id) return;
    readPosition.current = visible.id;
    void markConversationRead(id, { messageId: visible.id }).then(() => client.invalidateQueries({ queryKey: ['mobile', 'inbox', wallet] }))
      .catch(() => { readPosition.current = ''; });
  }).current;
  if (!wallet) return <Redirect href="/" />;
  const incoming = conversation?.directStatus === 'pending' && conversation.requesterAddress !== wallet;
  const outgoingRequest = conversation?.type === 'direct'
    && conversation.directStatus === 'pending' && conversation.requesterAddress === wallet;
  const awaitingApproval = outgoingRequest && Boolean(chat.data?.rows.length);
  const disabled = busy || !chat.data || !!chat.data.changed.length || incoming
    || awaitingApproval || conversation?.directStatus === 'declined' || conversation?.directMessagingBlocked;
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 8 }}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={() => router.replace('/')} style={{ padding: 10 }}><Text style={{ color: c.primary }}>‹ Chats</Text></Pressable>
          <Text style={[ui.subtitle, { color: c.foreground, flex: 1 }]} numberOfLines={1}>{conversation?.title || 'Private conversation'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Verify encryption" onPress={() => setShowSafety(!showSafety)} style={{ padding: 10 }}><Text style={{ color: c.primary }}>Verify</Text></Pressable>
        </View>
        {showSafety && <Label>Compare this code through another trusted channel: {chat.data ? safetyCode(chat.data.keys) : 'Loading…'}</Label>}
        {group && <View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showMembers }} onPress={() => setShowMembers((value) => !value)} style={{ paddingVertical: 6 }}>
            <Text style={{ color: c.primary, fontSize: 12 }}>{showMembers ? 'Hide' : 'Manage'} room members · {conversation?.memberCount ?? chat.data?.keys.length ?? 0}</Text>
          </Pressable>
          {showMembers && <View style={{ gap: 7, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
            {(chat.data?.keys ?? []).map((member) => <View key={member.walletAddress} style={[ui.row, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={[ui.row, { gap: 5 }]}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flexShrink: 1 }}>{member.username ? `@${member.username}` : `${member.walletAddress.slice(0, 7)}…${member.walletAddress.slice(-5)}`}</Text>
                  <HermitHolderStar walletAddress={member.walletAddress} size={13} />
                </View>
                <Label muted>{member.publicKey ? 'Encryption key ready' : 'Device key not set'}</Label>
              </View>
              {conversation?.canManageGroup && member.walletAddress !== wallet && !member.isGroupCreator && <Pressable accessibilityRole="button" onPress={() => removeMember(member.walletAddress)} disabled={busy}><Text style={{ color: c.secondary, fontSize: 11 }}>Remove</Text></Pressable>}
            </View>)}
            {conversation?.canManageGroup && <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, gap: 7 }}>
              <Label>Removed members · restore to allow them to join again</Label>
              {removedMembers.isLoading ? <ActivityIndicator color={c.primary} /> : removedMembers.data?.length ? removedMembers.data.map((member) => <View key={member.walletAddress} style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11, flex: 1 }}>{member.walletAddress.slice(0, 7)}…{member.walletAddress.slice(-5)}</Text>
                <Pressable accessibilityRole="button" onPress={() => restoreMember(member.walletAddress)} disabled={busy}><Text style={{ color: c.primary, fontSize: 11 }}>Restore</Text></Pressable>
              </View>) : <Label muted>No wallets have been removed.</Label>}
            </View>}
          </View>}
        </View>}
        {chat.data?.changed.length ? <>
          <Label>Encryption keys changed for {chat.data.changed.map((k) => k.username || k.walletAddress).join(', ')}. Sending is paused. Compare the safety code outside Frogtown before trusting.</Label>
          <Button secondary title="I verified these new encryption keys" onPress={() => void action(async () => { await trustKeys(wallet, id, chat.data!.keys); })} />
        </> : null}
        {group && chat.data?.keys.some((k) => !k.publicKey) && <Label muted>Some members have no device key. New messages reach only key-ready members.</Label>}
        {incoming && <>
          <Label>A member wants to send you private messages. You can accept, decline, or block them.</Label>
          <View style={ui.row}><View style={{ flex: 1 }}><Button title="Accept" busy={busy} onPress={() => void action(() => acceptConversationRequest(id))} /></View><View style={{ flex: 1 }}><Button secondary title="Decline" busy={busy} onPress={() => void action(() => declineConversationRequest(id))} /></View></View>
        </>}
        {outgoingRequest && <Label>{awaitingApproval
          ? 'Your introduction was sent to their private-message requests. They must accept before you can send more. “Sent” does not mean they have read it.'
          : 'This is a new private-message request. Send one encrypted introduction; they must accept before you can continue chatting.'}</Label>}
        {conversation?.type === 'direct' && !!conversation.otherWalletAddress && <Pressable onPress={() => {
          const block = () => void action(async () => { await blockWallet({ blockedWalletAddress: conversation.otherWalletAddress! }); });
          if (Platform.OS === 'web') { if (window.confirm('Block this wallet from private messaging?')) block(); }
          else Alert.alert('Block this wallet?', 'They will no longer be able to send you private messages.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: block }]);
        }}><Text style={{ color: c.secondary, fontSize: 12 }}>Block unwanted wallet</Text></Pressable>}
      </View>
      {chat.isLoading ? <ActivityIndicator color={c.primary} /> : null}
      {chat.error || inbox.error ? <View style={{ padding: 16 }}><Label>{errorText(chat.error || inbox.error)}</Label><Button secondary title="Retry loading chat" onPress={() => void action(async () => { await inbox.refetch(); })} /></View> : null}
      <FlatList
        style={{ flex: 1 }} inverted data={chat.data?.rows ?? []} keyExtractor={(row) => row.id}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 10 }}
        onViewableItemsChanged={onVisible} viewabilityConfig={viewability}
        ListEmptyComponent={!chat.isLoading ? <Label muted>No messages yet. Start the conversation.</Label> : null}
        renderItem={({ item }) => <View style={{ alignSelf: item.isMine ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: 13, borderRadius: 17, backgroundColor: item.isMine ? c.primary : c.card, borderWidth: 1, borderColor: item.isMine ? c.primary : c.border }}>
           {!item.isMine && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
             <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>{item.senderUsername ? `@${item.senderUsername}` : `${item.senderAddress.slice(0, 7)}…${item.senderAddress.slice(-5)}`}</Text>
             <HermitHolderStar walletAddress={item.senderAddress} size={14} />
           </View>}
          <Text selectable style={{ color: item.isMine ? c.primaryForeground : c.foreground, lineHeight: 21 }}>{item.text}</Text>
          <Text style={{ marginTop: 5, fontSize: 10, color: item.isMine ? c.primaryForeground : c.mutedForeground }}>{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{item.isMine ? item.isRead ? '  ✓✓ Read' : outgoingRequest ? '  ✓ Request sent' : '  ✓ Sent' : ''}</Text>
           {group && conversation?.canManageGroup && <Pressable accessibilityRole="button" accessibilityLabel="Delete this group message for everyone" onPress={() => removeGroupMessage(item.id)} disabled={busy} style={{ paddingTop: 7 }}>
             <Text style={{ color: c.secondary, fontSize: 11 }}>Delete for everyone</Text>
           </Pressable>}
        </View>}
      />
      <View style={{ padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card }}>
        {error ? <Label>{error}</Label> : null}
        {pending && <>
          <Label>One encrypted message is waiting for confirmation. It stays safe if the app restarts.</Label>
          <View style={ui.row}><View style={{ flex: 1 }}><Button title="Retry pending message" busy={busy} onPress={() => void send(true)} /></View><View style={{ flex: 1 }}><Button secondary title="Discard retry copy" onPress={() => {
            const discard = () => void removePending(wallet, pending.messageId).then(() => setPending(null)).catch((e) => setError(errorText(e)));
            if (Platform.OS === 'web') { if (window.confirm('Discard this local retry copy? The server may already have received the message.')) discard(); }
            else Alert.alert('Discard retry copy?', 'The server may already have received it. This only removes the phone’s pending copy.', [{ text: 'Cancel' }, { text: 'Discard', style: 'destructive', onPress: discard }]);
          }} /></View></View>
        </>}
        <View style={ui.row}><View style={{ flex: 1 }}><Field multiline maxLength={5000} placeholder="Write an encrypted message…" accessibilityLabel="Message" value={text} onChangeText={setText} editable={!disabled && !pending} /></View><Button title="Send" busy={busy} disabled={!!disabled || !!pending || !text.trim()} onPress={() => void send()} /></View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export default function ChatScreen() {
  return <SessionGate><ChatContent /></SessionGate>;
}
