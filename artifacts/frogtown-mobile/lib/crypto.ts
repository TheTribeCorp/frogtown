import { p256 } from '@noble/curves/p256';
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { base64urlnopad, utf8 } from '@scure/base';

export type PublicJwk = { kty: string; crv: string; x: string; y: string; ext?: boolean; key_ops?: string[] };
export type Identity = { publicJwk: PublicJwk; privateJwk: PublicJwk & { d: string } };
export type MemberKey = { walletAddress: string; username?: string | null; publicKey: string | null };
export type RandomBytes = (length: number) => Uint8Array;
const encode = (value: string) => utf8.decode(value);
const decode = (value: Uint8Array) => utf8.encode(value);
export const canonicalKey = (key: PublicJwk) => JSON.stringify(Object.fromEntries(Object.entries(key).sort(([a], [b]) => a.localeCompare(b))));
export const pkceChallenge = (verifier: string) => base64urlnopad.encode(sha256(encode(verifier)));
export const randomSecret = (random: RandomBytes) => base64urlnopad.encode(random(32));

function publicPoint(key: PublicJwk) {
  if (key.kty !== 'EC' || key.crv !== 'P-256') throw new Error('Unsupported encryption key.');
  const x = base64urlnopad.decode(key.x), y = base64urlnopad.decode(key.y);
  if (x.length !== 32 || y.length !== 32) throw new Error('Invalid encryption key.');
  return new Uint8Array([4, ...x, ...y]);
}

export function generateIdentity(random: RandomBytes): Identity {
  let privateBytes = random(32);
  while (!p256.utils.isValidPrivateKey(privateBytes)) privateBytes = random(32);
  const point = p256.getPublicKey(privateBytes, false);
  const publicJwk: PublicJwk = {
    key_ops: [], ext: true, kty: 'EC', x: base64urlnopad.encode(point.slice(1, 33)),
    y: base64urlnopad.encode(point.slice(33)), crv: 'P-256',
  };
  return { publicJwk, privateJwk: { ...publicJwk, key_ops: ['deriveBits'], d: base64urlnopad.encode(privateBytes) } };
}

export function validateIdentity(identity: Identity) {
  const point = p256.getPublicKey(base64urlnopad.decode(identity.privateJwk.d), false);
  const expected = publicPoint(identity.publicJwk);
  if (point.some((byte, index) => byte !== expected[index])
    || identity.privateJwk.x !== identity.publicJwk.x || identity.privateJwk.y !== identity.publicJwk.y) {
    throw new Error('The private and public keys in this backup do not match.');
  }
}

function conversationKey(identity: Identity, remote: PublicJwk, conversationId: string, a: string, b: string) {
  const shared = p256.getSharedSecret(base64urlnopad.decode(identity.privateJwk.d), publicPoint(remote), false).slice(1, 33);
  return hkdf(sha256, shared, encode(`swamp-e2ee-v1:${conversationId}`), encode(`participants:${[a, b].sort().join(':')}`), 32);
}

export function encryptMessage(message: string, conversationId: string, sender: string, identity: Identity, members: MemberKey[], random: RandomBytes, allowMissing = false) {
  if (!allowMissing && members.some((member) => !member.publicKey)) throw new Error('The other member needs to register an encryption key before you can send.');
  const entries: Record<string, { iv: string; ciphertext: string }> = {};
  for (const member of members) {
    if (!member.publicKey) continue;
    const key = conversationKey(identity, JSON.parse(member.publicKey), conversationId, sender, member.walletAddress);
    const iv = random(12);
    entries[member.walletAddress] = { iv: base64urlnopad.encode(iv), ciphertext: base64urlnopad.encode(gcm(key, iv).encrypt(encode(message))) };
  }
  if (!entries[sender] && !allowMissing) throw new Error('Your own encryption key is unavailable.');
  return `e2ee:v1:${base64urlnopad.encode(encode(JSON.stringify({ version: 1, entries })))}`;
}

export function decryptMessage(body: string, conversationId: string, sender: string, recipient: string, identity: Identity, members: MemberKey[]) {
  if (!body.startsWith('e2ee:v1:') || body.length > 1_000_000) throw new Error('Unsupported encrypted message.');
  const envelope = JSON.parse(decode(base64urlnopad.decode(body.slice(8))));
  if (envelope.version !== 1 || !envelope.entries || !Object.hasOwn(envelope.entries, recipient)) throw new Error('History has not been shared with this device yet.');
  const entry = envelope.entries[recipient];
  const senderKey = members.find((member) => member.walletAddress === sender)?.publicKey;
  if (!senderKey) throw new Error('The sender’s encryption key is unavailable.');
  const iv = base64urlnopad.decode(entry.iv);
  if (iv.length !== 12) throw new Error('Invalid encrypted message.');
  const key = conversationKey(identity, JSON.parse(senderKey), conversationId, sender, recipient);
  return decode(gcm(key, iv).decrypt(base64urlnopad.decode(entry.ciphertext)));
}

export function safetyCode(members: MemberKey[]) {
  const canonical = members.map((member) => `${member.walletAddress}:${member.publicKey ?? 'missing'}`).sort().join('|');
  return [...sha256(encode(canonical)).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('').match(/.{1,4}/g)!.join('-');
}

export async function exportBackup(walletAddress: string, identity: Identity, passphrase: string, random: RandomBytes) {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  validateIdentity(identity);
  const salt = random(16), iv = random(12), iterations = 310_000;
  const key = await pbkdf2Async(sha256, encode(passphrase), salt, { c: iterations, dkLen: 32 });
  const ciphertext = gcm(key, iv).encrypt(encode(JSON.stringify({ walletAddress, ...identity })));
  return JSON.stringify({
    format: 'frogtown-e2ee-backup', version: 1, kdf: 'PBKDF2-SHA-256', iterations,
    salt: base64urlnopad.encode(salt), iv: base64urlnopad.encode(iv), ciphertext: base64urlnopad.encode(ciphertext),
  }, null, 2);
}

export async function importBackup(wallet: string, text: string, passphrase: string): Promise<Identity> {
  if (text.length > 64 * 1024) throw new Error('This recovery file is too large.');
  const backup = JSON.parse(text);
  if (backup.format !== 'frogtown-e2ee-backup' || backup.version !== 1 || backup.kdf !== 'PBKDF2-SHA-256'
    || !Number.isInteger(backup.iterations) || backup.iterations < 100_000 || backup.iterations > 1_000_000) throw new Error('Unsupported Frogtown recovery file.');
  let payload;
  try {
    const iv = base64urlnopad.decode(backup.iv);
    if (iv.length !== 12) throw new Error('Invalid IV');
    const key = await pbkdf2Async(sha256, encode(passphrase), base64urlnopad.decode(backup.salt), { c: backup.iterations, dkLen: 32 });
    payload = JSON.parse(decode(gcm(key, iv).decrypt(base64urlnopad.decode(backup.ciphertext))));
  } catch { throw new Error('The passphrase is incorrect or the recovery file is damaged.'); }
  if (payload.walletAddress !== wallet) throw new Error('This backup belongs to a different wallet.');
  validateIdentity(payload);
  return { publicJwk: payload.publicJwk, privateJwk: payload.privateJwk };
}
