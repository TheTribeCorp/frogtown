import AsyncStorage from '@react-native-async-storage/async-storage';
export type PendingMessage = { conversationId: string; messageId: string; encryptedBody: string; createdAt: string; keyDigest: string };
const key = (wallet: string) => `frogtown.native.outbox.${wallet}`;
let writes = Promise.resolve();
export async function loadOutbox(wallet: string): Promise<PendingMessage[]> {
  const raw = await AsyncStorage.getItem(key(wallet));
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((p) => typeof p.conversationId === 'string'
    && /^[0-9a-f-]{36}$/i.test(p.messageId) && p.encryptedBody?.startsWith('e2ee:v1:')
    && typeof p.keyDigest === 'string'
    && Number.isFinite(Date.parse(p.createdAt)))) throw new Error('The encrypted retry record is damaged. Do not clear app storage before recovering it.');
  return parsed;
}
export function savePending(wallet: string, pending: PendingMessage) {
  const operation = writes.then(async () => {
    const existing = await loadOutbox(wallet);
    if (existing.some((p) => p.conversationId === pending.conversationId && p.messageId !== pending.messageId)) throw new Error('Retry the previous message before sending another.');
    if (existing.length >= 20 && !existing.some((p) => p.messageId === pending.messageId)) throw new Error('Confirm pending messages before sending more.');
    await AsyncStorage.setItem(key(wallet), JSON.stringify([...existing.filter((p) => p.messageId !== pending.messageId), pending]));
  });
  writes = operation.catch(() => {});
  return operation;
}
export function removePending(wallet: string, messageId: string) {
  const operation = writes.then(async () => {
    const remaining = (await loadOutbox(wallet)).filter((p) => p.messageId !== messageId);
    await AsyncStorage.setItem(key(wallet), JSON.stringify(remaining));
  });
  writes = operation.catch(() => {});
  return operation;
}
export async function clearChatState(wallet: string) {
  await writes;
  const keys = await AsyncStorage.getAllKeys();
  const scoped = keys.filter((k) => k === key(wallet) || k.startsWith(`frogtown.native.trust.${wallet}.`) || k.startsWith(`frogtown.native.history.${wallet}.`));
  await AsyncStorage.multiRemove(scoped);
}
