import { getWalletEncryptionKey, registerWalletEncryptionKey } from '@workspace/api-client-react';

const DATABASE_NAME = 'swamp-identity-keys';
const STORE_NAME = 'identities';
const PROTOCOL_PREFIX = 'e2ee:v1:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type LocalIdentityKey = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
};

export type ConversationPublicKey = {
  walletAddress: string;
  publicKey: string | null;
};

type CipherEntry = { iv: string; ciphertext: string };
type MessageEnvelope = { version: 1; entries: Record<string, CipherEntry> };

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local encryption key vault.'));
  });
}

async function readLocalKey(walletAddress: string): Promise<LocalIdentityKey | null> {
  const database = await openKeyDatabase();
  return new Promise<LocalIdentityKey | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(walletAddress);
    request.onsuccess = () => resolve((request.result as LocalIdentityKey | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Could not read the local encryption key.'));
  }).finally(() => database.close());
}

async function storeLocalKey(walletAddress: string, key: LocalIdentityKey): Promise<void> {
  const database = await openKeyDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(key, walletAddress);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the local encryption key.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving the local encryption key was interrupted.'));
  }).finally(() => database.close());
}

async function generateIdentityKey(): Promise<LocalIdentityKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk };
}

function getStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
}

function canonicalKey(publicJwk: JsonWebKey): string {
  return JSON.stringify(Object.fromEntries(Object.entries(publicJwk).sort(([left], [right]) => left.localeCompare(right))));
}

export async function ensureIdentityKey(walletAddress: string): Promise<LocalIdentityKey> {
  const localKey = await readLocalKey(walletAddress);
  let serverKey: string | null = null;
  try {
    serverKey = (await getWalletEncryptionKey(walletAddress)).publicKey;
  } catch (error) {
    if (getStatus(error) !== 404) throw error;
  }

  if (serverKey) {
    if (!localKey) {
      throw new Error('This wallet already has an encryption key on another device. Restore that device’s key before continuing; key transfer is not available yet.');
    }
    if (canonicalKey(localKey.publicJwk) !== serverKey) {
      throw new Error('The local encryption key does not match the registered wallet key. We did not replace it, to protect access to older messages.');
    }
    return localKey;
  }

  const key = localKey ?? await generateIdentityKey();
  if (!localKey) await storeLocalKey(walletAddress, key);
  const publicKey = canonicalKey(key.publicJwk);
  try {
    await registerWalletEncryptionKey({ publicKey });
  } catch (error) {
    if (getStatus(error) !== 409) throw error;
    const racedKey = await getWalletEncryptionKey(walletAddress);
    if (racedKey.publicKey !== publicKey) {
      throw new Error('A different encryption key was registered for this wallet. Restore that device’s key before continuing.');
    }
  }
  return key;
}

export async function getLocalIdentityKey(walletAddress: string): Promise<LocalIdentityKey> {
  const key = await readLocalKey(walletAddress);
  if (!key) throw new Error('The local encryption key is missing from this device.');
  return key;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveConversationKey(
  privateKey: CryptoKey,
  remotePublicJwk: JsonWebKey,
  conversationId: string,
  walletA: string,
  walletB: string,
): Promise<CryptoKey> {
  const remotePublicKey = await crypto.subtle.importKey(
    'jwk',
    remotePublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: remotePublicKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const participants = [walletA, walletB].sort().join(':');
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(`swamp-e2ee-v1:${conversationId}`),
      info: encoder.encode(`participants:${participants}`),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptForConversation(
  message: string,
  conversationId: string,
  senderAddress: string,
  identity: LocalIdentityKey,
  members: ConversationPublicKey[],
): Promise<string> {
  if (members.some((member) => !member.publicKey)) {
    throw new Error('Every member must connect Frogtown on a device with an encryption key before this room can receive encrypted messages.');
  }
  const entries: Record<string, CipherEntry> = {};
  for (const member of members) {
    const publicJwk = JSON.parse(member.publicKey!) as JsonWebKey;
    const key = await deriveConversationKey(
      identity.privateKey,
      publicJwk,
      conversationId,
      senderAddress,
      member.walletAddress,
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(message));
    entries[member.walletAddress] = {
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    };
  }
  const envelope: MessageEnvelope = { version: 1, entries };
  return `${PROTOCOL_PREFIX}${encodeBase64Url(encoder.encode(JSON.stringify(envelope)))}`;
}

export async function decryptForConversation(
  encryptedBody: string,
  conversationId: string,
  senderAddress: string,
  recipientAddress: string,
  identity: LocalIdentityKey,
  members: ConversationPublicKey[],
): Promise<string> {
  if (!encryptedBody.startsWith(PROTOCOL_PREFIX)) {
    return 'This message predates recipient-only encryption and is not readable on this device.';
  }
  const envelopeText = decoder.decode(decodeBase64Url(encryptedBody.slice(PROTOCOL_PREFIX.length)));
  const envelope = JSON.parse(envelopeText) as MessageEnvelope;
  if (envelope.version !== 1 || !envelope.entries || typeof envelope.entries !== 'object') {
    throw new Error('This encrypted message has an unsupported format.');
  }
  const entry = envelope.entries[recipientAddress];
  if (!entry) return 'This message was sent before this wallet joined the room.';
  const senderKey = members.find((member) => member.walletAddress === senderAddress)?.publicKey;
  if (!senderKey) throw new Error('The sender’s public encryption key is unavailable.');
  const key = await deriveConversationKey(
    identity.privateKey,
    JSON.parse(senderKey) as JsonWebKey,
    conversationId,
    senderAddress,
    recipientAddress,
  );
  const iv = new Uint8Array(decodeBase64Url(entry.iv));
  const ciphertext = new Uint8Array(decodeBase64Url(entry.ciphertext));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return decoder.decode(plaintext);
}

export async function conversationSafetyCode(members: ConversationPublicKey[]): Promise<string> {
  const canonical = members
    .map((member) => `${member.walletAddress}:${member.publicKey ?? 'missing'}`)
    .sort()
    .join('|');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)));
  return Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('')
    .match(/.{1,4}/g)
    ?.join('-') ?? '';
}
