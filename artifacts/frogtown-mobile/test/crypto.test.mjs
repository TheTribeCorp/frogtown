import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateIdentity, encryptMessage, decryptMessage, canonicalKey,
  exportBackup, importBackup, validateIdentity, pkceChallenge,
} from '../lib/crypto.ts';
import { encryptForConversation, decryptForConversation, conversationSafetyCode } from '../../swamp-chat/src/lib/e2ee-crypto.ts';
import { createEncryptedIdentityBackupFile, decryptEncryptedIdentityBackupFile } from '../../swamp-chat/src/lib/e2ee-backup.ts';
import { safetyCode } from '../lib/crypto.ts';
const random = (length) => crypto.getRandomValues(new Uint8Array(length));
const a = generateIdentity(random), b = generateIdentity(random);
const keys = [
  { walletAddress: 'alice', publicKey: canonicalKey(a.publicJwk) },
  { walletAddress: 'bob', publicKey: canonicalKey(b.publicJwk) },
];
async function webIdentity(identity) {
  return { privateKey: await crypto.subtle.importKey('jwk', identity.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), publicJwk: identity.publicJwk };
}
test('native messages decrypt on web and web messages decrypt natively', async () => {
  const fromNative = encryptMessage('hello from native 🐸', 'room', 'alice', a, keys, random);
  assert.equal(await decryptForConversation(fromNative, 'room', 'alice', 'bob', await webIdentity(b), keys), 'hello from native 🐸');
  const fromWeb = await encryptForConversation('hello from web', 'room', 'bob', await webIdentity(b), keys);
  assert.equal(decryptMessage(fromWeb, 'room', 'bob', 'alice', a, keys), 'hello from web');
  assert.equal(decryptMessage(fromNative, 'room', 'alice', 'alice', a, keys), 'hello from native 🐸');
  assert.equal(safetyCode(keys), await conversationSafetyCode(keys));
});
test('wrong participants, conversation, keys and tampered ciphertext cannot decrypt', () => {
  const message = encryptMessage('secret', 'room', 'alice', a, keys, random);
  assert.throws(() => decryptMessage(message, 'other-room', 'alice', 'bob', b, keys));
  assert.throws(() => decryptMessage(message, 'room', 'alice', 'mallory', b, keys));
  assert.throws(() => decryptMessage(message, 'room', 'alice', 'bob', generateIdentity(random), keys));
  assert.throws(() => decryptMessage(`${message.slice(0, -10)}AAAAAAAAAA`, 'room', 'alice', 'bob', b, keys));
});
test('groups explicitly permit missing keys; direct sends do not', () => {
  const members = [...keys, { walletAddress: 'carol', publicKey: null }];
  assert.throws(() => encryptMessage('test', 'room', 'alice', a, members, random));
  const message = encryptMessage('test', 'room', 'alice', a, members, random, true);
  assert.equal(decryptMessage(message, 'room', 'alice', 'bob', b, members), 'test');
  assert.throws(() => decryptMessage(message, 'room', 'alice', 'carol', b, members));
});
test('recovery backups restore in both directions and reject wrong wallet/passphrase', async () => {
  const passphrase = 'test-only long recovery phrase';
  const exported = await exportBackup('alice', a, passphrase, random);
  const fromNative = await decryptEncryptedIdentityBackupFile('alice', new Blob([exported]), passphrase);
  assert.equal(fromNative.privateJwk.d, a.privateJwk.d);
  const fromWeb = await createEncryptedIdentityBackupFile('alice', await webIdentity(a), passphrase);
  const imported = await importBackup('alice', await fromWeb.text(), passphrase);
  assert.equal(canonicalKey(imported.publicJwk), canonicalKey(a.publicJwk));
  await assert.rejects(importBackup('bob', exported, passphrase), /different wallet/);
  await assert.rejects(importBackup('alice', exported, 'wrong'), /incorrect/);
  assert.throws(() => validateIdentity({ publicJwk: b.publicJwk, privateJwk: a.privateJwk }), /do not match/);
});
test('PKCE S256 matches the standard known vector', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
