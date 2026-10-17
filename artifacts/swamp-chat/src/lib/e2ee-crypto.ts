const PROTOCOL_PREFIX = 'e2ee:v1:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CipherEntry = { iv: string; ciphertext: string };
type MessageEnvelope = { version: 1; entries: Record<string, CipherEntry> };

export type ConversationPublicKey = {
  walletAddress: string;
  username?: string | null;
  publicKey: string | null;
};

export function getEncryptedMessageRecipients(encryptedBody: string): string[] {
  if (!encryptedBody.startsWith(PROTOCOL_PREFIX)) return [];
  try {
    const envelope = JSON.parse(
      decoder.decode(decodeBase64Url(encryptedBody.slice(PROTOCOL_PREFIX.length))),
    ) as MessageEnvelope;
    if (envelope.version !== 1 || !envelope.entries || typeof envelope.entries !== 'object' || Array.isArray(envelope.entries)) {
      return [];
    }
    return Object.entries(envelope.entries)
      .filter(([address, entry]) => Boolean(address) && typeof entry?.iv === 'string' && typeof entry?.ciphertext === 'string')
      .map(([address]) => address);
  } catch {
    return [];
  }
}

type IdentityCryptoKey = {
  privateKey: CryptoKey;
};

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
  identity: IdentityCryptoKey,
  members: ConversationPublicKey[],
  allowMissingMemberKeys = false,
): Promise<string> {
  if (!allowMissingMemberKeys && members.some((member) => !member.publicKey)) {
    throw new Error('Every member must connect Frogtown on a device with an encryption key before this room can receive encrypted messages.');
  }
  const recipients = members.filter((member): member is ConversationPublicKey & { publicKey: string } => Boolean(member.publicKey));
  const entries: Record<string, CipherEntry> = {};
  for (const member of recipients) {
    const publicJwk = JSON.parse(member.publicKey) as JsonWebKey;
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
  identity: IdentityCryptoKey,
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
  if (!entry) return 'This message was not encrypted for this device.';
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
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
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
