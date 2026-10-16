const IDENTITY_BACKUP_FORMAT = 'frogtown-e2ee-backup';
const IDENTITY_BACKUP_ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type IdentityBackupFile = {
  format: typeof IDENTITY_BACKUP_FORMAT;
  version: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type IdentityBackupPayload = {
  walletAddress: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
};

type ExportableIdentity = {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('This is not a supported Frogtown encryption backup.');
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

export async function createEncryptedIdentityBackupFile(
  walletAddress: string,
  identity: ExportableIdentity,
  passphrase: string,
): Promise<Blob> {
  if (passphrase.length < 12) throw new Error('Choose a recovery passphrase with at least 12 characters.');
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

export async function decryptEncryptedIdentityBackupFile(
  walletAddress: string,
  backupFile: Pick<Blob, 'size' | 'text'>,
  passphrase: string,
): Promise<IdentityBackupPayload> {
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
  return payload;
}
