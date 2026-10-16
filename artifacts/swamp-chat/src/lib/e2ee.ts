import { getWalletEncryptionKey, registerWalletEncryptionKey } from '@workspace/api-client-react';
import {
  createEncryptedIdentityBackupFile,
  decryptEncryptedIdentityBackupFile,
} from './e2ee-backup';

const DATABASE_NAME = 'swamp-identity-keys';
const STORE_NAME = 'identities';

export {
  conversationSafetyCode,
  decryptForConversation,
  encryptForConversation,
  getEncryptedMessageRecipients,
} from './e2ee-crypto';
export type { ConversationPublicKey } from './e2ee-crypto';
export {
  getConversationKeyChanges,
  trustConversationKeyChange,
} from './e2ee-key-trust';
export type { ConversationKeyChange } from './e2ee-key-trust';

export type LocalIdentityKey = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
};

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
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
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
      throw new Error('This wallet already has an encryption key on another device. Restore its Frogtown encrypted backup before continuing.');
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
      throw new Error('A different encryption key was registered for this wallet. Restore its Frogtown encrypted backup before continuing.');
    }
  }
  return key;
}

export async function getLocalIdentityKey(walletAddress: string): Promise<LocalIdentityKey> {
  const key = await readLocalKey(walletAddress);
  if (!key) throw new Error('The local encryption key is missing from this device.');
  return key;
}

export async function createEncryptedIdentityBackup(walletAddress: string, passphrase: string): Promise<Blob> {
  const identity = await getLocalIdentityKey(walletAddress);
  return createEncryptedIdentityBackupFile(walletAddress, identity, passphrase);
}

export async function restoreEncryptedIdentityBackup(
  walletAddress: string,
  backupFile: File,
  passphrase: string,
): Promise<void> {
  const payload = await decryptEncryptedIdentityBackupFile(walletAddress, backupFile, passphrase);
  const privateJwk = payload.privateJwk;
  const publicJwk = payload.publicJwk;
  if (privateJwk?.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.d
    || publicJwk?.kty !== 'EC' || publicJwk.crv !== 'P-256' || !publicJwk.x || !publicJwk.y) {
    throw new Error('The backup does not contain a valid Frogtown encryption key.');
  }

  const localKey = await readLocalKey(walletAddress);
  const publicKeyText = canonicalKey(publicJwk);
  if (localKey && canonicalKey(localKey.publicJwk) !== publicKeyText) {
    throw new Error('This browser already has a different encryption key for this wallet. We did not replace it.');
  }
  let serverKey: string | null = null;
  try {
    serverKey = (await getWalletEncryptionKey(walletAddress)).publicKey;
  } catch (error) {
    if (getStatus(error) !== 404) throw error;
  }
  if (serverKey && serverKey !== publicKeyText) {
    throw new Error('This backup does not match the wallet’s registered public key.');
  }

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const probe = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const [secretFromPrivate, secretFromPublic] = await Promise.all([
    crypto.subtle.deriveBits({ name: 'ECDH', public: probe.publicKey }, privateKey, 256),
    crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, probe.privateKey, 256),
  ]);
  const left = new Uint8Array(secretFromPrivate);
  const right = new Uint8Array(secretFromPublic);
  if (left.length !== right.length || left.some((byte, index) => byte !== right[index])) {
    throw new Error('The private and public keys in this backup do not match.');
  }

  if (!serverKey) {
    try {
      await registerWalletEncryptionKey({ publicKey: publicKeyText });
    } catch (error) {
      if (getStatus(error) !== 409) throw error;
      const racedKey = await getWalletEncryptionKey(walletAddress);
      if (racedKey.publicKey !== publicKeyText) {
        throw new Error('A different encryption key was registered for this wallet.');
      }
    }
  }
  if (!localKey) await storeLocalKey(walletAddress, { privateKey, publicKey, publicJwk });
}
