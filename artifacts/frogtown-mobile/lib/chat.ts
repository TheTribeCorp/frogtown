import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  getConversationEncryptionKeys, listConversationMessages, listConversationHistoryShares,
  listConversationHistoryShareWork, createConversationHistoryShare,
} from '@workspace/api-client-react';
import { canonicalKey, decryptMessage, encryptMessage, type Identity, type MemberKey } from './crypto';
import { ensureIdentity } from './identity';

const trustKey = (wallet: string, id: string) => `frogtown.native.trust.${wallet}.${id}`;
export async function trustKeys(wallet: string, id: string, keys: MemberKey[]) {
  await AsyncStorage.setItem(trustKey(wallet, id), JSON.stringify(Object.fromEntries(keys.filter((k) => k.publicKey).map((k) => [k.walletAddress, k.publicKey]))));
}
export async function loadChat(wallet: string, id: string, identity: Identity, group: boolean) {
  const currentIdentity = await ensureIdentity(wallet);
  if (canonicalKey(currentIdentity.publicJwk) !== canonicalKey(identity.publicJwk)) throw new Error('Your encryption identity changed. Reopen the chat.');
  const [keys, messages, shares, saved] = await Promise.all([
    getConversationEncryptionKeys(id), listConversationMessages(id, { walletAddress: wallet }),
    group ? listConversationHistoryShares(id) : Promise.resolve([]), AsyncStorage.getItem(trustKey(wallet, id)),
  ]);
  const trusted = saved ? JSON.parse(saved) as Record<string, string> : {};
  const changed = keys.filter((key) => key.publicKey && trusted[key.walletAddress] && trusted[key.walletAddress] !== key.publicKey);
  if (!changed.length) await trustKeys(wallet, id, keys);
  const rows = messages.map((message) => {
    const share = shares.find((s) => s.messageId === message.id);
    try {
      return { ...message, readable: true, text: decryptMessage(share?.body ?? message.body, id, share?.sharedByAddress ?? message.senderAddress, wallet, identity, keys) };
    } catch {
      return { ...message, readable: false, text: 'Encrypted history is not available on this device yet.' };
    }
  }).reverse();
  return { keys, changed, rows };
}
const sharing = new Set<string>();
export async function shareGroupHistory(wallet: string, id: string, identity: Identity, keys: MemberKey[]) {
  const key = `frogtown.native.history.${wallet}.${id}`;
  if (sharing.has(key)) return;
  sharing.add(key);
  try {
    const cursor = await AsyncStorage.getItem(key);
    const page = await listConversationHistoryShareWork(id, cursor ? { cursor } : undefined);
    for (const work of page.items) {
      if (keys.find((member) => member.walletAddress === work.recipientAddress)?.publicKey !== work.recipientPublicKey) {
        throw new Error('A recipient key changed during history sharing. Refresh and verify keys before continuing.');
      }
      const plaintext = decryptMessage(work.body, id, work.senderAddress, wallet, identity, keys);
      const body = encryptMessage(plaintext, id, wallet, identity, [{ walletAddress: work.recipientAddress, publicKey: work.recipientPublicKey }], Crypto.getRandomBytes, true);
      await createConversationHistoryShare(id, { messageId: work.messageId, recipientAddress: work.recipientAddress, body });
    }
    if (page.nextCursor) await AsyncStorage.setItem(key, page.nextCursor);
  } finally { sharing.delete(key); }
}
