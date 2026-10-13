import { getWalletEncryptionKey, registerWalletEncryptionKey } from '@workspace/api-client-react';

const DATABASE_NAME = 'swamp-identity-keys';
const STORE_NAME = 'identities';
const IDENTITY_BACKUP_FORMAT = 'frogtown-e2ee-backup';
const IDENTITY_BACKUP_ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export {
  conversationSafetyCode,
  decryptForConversation,
  encryptForConversation,
} from './e2ee-crypto';
export type { ConversationPublicKey } from './e2ee-crypto';

export type LocalIdentityKey = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
};

type IdentityBackupFile = {
  format: typeof IDENTITY_BACKUP_FORMAT;
  version: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};
type IdentityBackupPayload = {
  walletAddress: string;
  privateJwk: JsonWebKey;
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

async function deriveBackupWrappingKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt).buffer, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createEncryptedIdentityBackup(walletAddress: string, passphrase: string): Promise<Blob> {
  if (passphrase.length < 12) throw new Error('Choose a recovery passphrase with at least 12 characters.');
  const identity = await getLocalIdentityKey(walletAddress);
  if (!identity.privateKey.extractable) {
    throw new Error('This older encryption key cannot be exported. Keep the browser where it was created; replacing it could make old chats unreadable.');
  }
  const privateJwk = await crypto.subtle.exportKey('jwk', identity.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveBackupWrappingKey(passphrase, salt, IDENTITY_BACKUP_ITERATIONS);
  const payload: IdentityBackupPayload = {
    walletAddress,
    privateJwk,
    publicJwk: identity.publicJwk,
  };
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    encoder.encode(JSON.stringify(payload)),
  );
  const backup: IdentityBackupFile = {
    format: IDENTITY_BACKUP_FORMAT,
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: IDENTITY_BACKUP_ITERATIONS,
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

export async function restoreEncryptedIdentityBackup(
  walletAddress: string,
  backupFile: File,
  passphrase: string,
): Promise<void> {
  if (passphrase.length < 1) throw new Error('Enter the recovery passphrase for this backup.');
  if (backupFile.size > 64 * 1024) throw new Error('This recovery file is too large to be a Frogtown key backup.');

  let backup: IdentityBackupFile;
  try {
    backup = JSON.parse(await backupFile.text()) as IdentityBackupFile;
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (backup.format !== IDENTITY_BACKUP_FORMAT || backup.version !== 1
    || backup.kdf !== 'PBKDF2-SHA-256'
    || !Number.isInteger(backup.iterations)
    || backup.iterations < 100_000
    || backup.iterations > 1_000_000
    || typeof backup.salt !== 'string'
    || typeof backup.iv !== 'string'
    || typeof backup.ciphertext !== 'string') {
    throw new Error('This is not a supported Frogtown encryption backup.');
  }

  let payload: IdentityBackupPayload;
  try {
    const wrappingKey = await deriveBackupWrappingKey(
      passphrase,
      decodeBase64Url(backup.salt),
      backup.iterations,
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(decodeBase64Url(backup.iv)).buffer },
      wrappingKey,
      new Uint8Array(decodeBase64Url(backup.ciphertext)).buffer,
    );
    payload = JSON.parse(decoder.decode(plaintext)) as IdentityBackupPayload;
  } catch {
    throw new Error('The passphrase is incorrect or the backup file is damaged.');
  }

  if (payload.walletAddress !== walletAddress) {
    throw new Error('This backup belongs to a different XRPL wallet.');
  }
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
