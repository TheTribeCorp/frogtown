export type PendingEncryptedMessage = {
  conversationId: string;
  messageId: string;
  encryptedBody: string;
  createdAt: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const keyForWallet = (walletAddress: string) =>
  `frogtown:pending-encrypted-messages:${walletAddress}`;

function getSessionStorage(): StorageLike {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    throw new Error('This browser cannot keep a retry copy for this tab.');
  }
  return window.sessionStorage;
}

function isPendingMessage(value: unknown): value is PendingEncryptedMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PendingEncryptedMessage>;
  return typeof item.conversationId === 'string'
    && item.conversationId.length > 0
    && typeof item.messageId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.messageId)
    && typeof item.encryptedBody === 'string'
    && item.encryptedBody.startsWith('e2ee:v1:')
    && typeof item.createdAt === 'string'
    && Number.isFinite(Date.parse(item.createdAt));
}

export function loadPendingEncryptedMessages(
  walletAddress: string,
  storage: StorageLike = getSessionStorage(),
): PendingEncryptedMessage[] {
  const saved = storage.getItem(keyForWallet(walletAddress));
  if (saved === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error('Frogtown could not read this tab’s encrypted retry record. Do not clear site data until the message is recovered.');
  }
  if (!Array.isArray(parsed) || !parsed.every(isPendingMessage)) {
    throw new Error('Frogtown found an invalid encrypted retry record. Do not clear site data until the message is recovered.');
  }
  return parsed;
}

export function findPendingEncryptedMessage(
  walletAddress: string,
  conversationId: string,
  storage?: StorageLike,
): PendingEncryptedMessage | null {
  return loadPendingEncryptedMessages(walletAddress, storage)
    .find((message) => message.conversationId === conversationId) ?? null;
}

export function savePendingEncryptedMessage(
  walletAddress: string,
  pending: PendingEncryptedMessage,
  storage: StorageLike = getSessionStorage(),
): void {
  if (!isPendingMessage(pending)) {
    throw new Error('Frogtown could not safely save this encrypted retry copy.');
  }
  const saved = loadPendingEncryptedMessages(walletAddress, storage);
  const existing = saved.find((message) => message.conversationId === pending.conversationId);
  if (existing && existing.messageId !== pending.messageId) {
    throw new Error('Another message in this chat still needs confirmation. Retry or discard it before sending another.');
  }
  const next = [
    ...saved.filter((message) => message.conversationId !== pending.conversationId),
    pending,
  ].slice(-20);
  try {
    storage.setItem(keyForWallet(walletAddress), JSON.stringify(next));
  } catch {
    throw new Error('Frogtown could not save an encrypted retry copy in this tab, so the message was not sent.');
  }
}

export function removePendingEncryptedMessage(
  walletAddress: string,
  messageId: string,
  storage: StorageLike = getSessionStorage(),
): void {
  const remaining = loadPendingEncryptedMessages(walletAddress, storage)
    .filter((message) => message.messageId !== messageId);
  if (remaining.length === 0) {
    storage.removeItem(keyForWallet(walletAddress));
    return;
  }
  storage.setItem(keyForWallet(walletAddress), JSON.stringify(remaining));
}

export function removePendingForConversation(
  walletAddress: string,
  conversationId: string,
  storage: StorageLike = getSessionStorage(),
): void {
  const remaining = loadPendingEncryptedMessages(walletAddress, storage)
    .filter((message) => message.conversationId !== conversationId);
  if (remaining.length === 0) {
    storage.removeItem(keyForWallet(walletAddress));
    return;
  }
  storage.setItem(keyForWallet(walletAddress), JSON.stringify(remaining));
}

export function clearPendingEncryptedMessages(
  walletAddress: string,
  storage: StorageLike = getSessionStorage(),
): void {
  storage.removeItem(keyForWallet(walletAddress));
}
