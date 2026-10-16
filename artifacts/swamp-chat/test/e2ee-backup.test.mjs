import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEncryptedIdentityBackupFile,
  decryptEncryptedIdentityBackupFile,
} from '../src/lib/e2ee-backup.ts';

const walletAddress = 'r111111111111111111111111111111111';
const passphrase = 'riverbank-recovery-passphrase';

async function createIdentity() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
}

test('recovery backup encrypts the private key and restores it for the matching wallet', async () => {
  const identity = await createIdentity();
  const backup = await createEncryptedIdentityBackupFile(walletAddress, identity, passphrase);
  const backupText = await backup.text();

  assert.equal(backup.type, 'application/json');
  assert.ok(!backupText.includes(walletAddress));
  assert.ok(!backupText.includes(identity.privateKey ? (await crypto.subtle.exportKey('jwk', identity.privateKey)).d : ''));

  const restored = await decryptEncryptedIdentityBackupFile(walletAddress, backup, passphrase);
  assert.equal(restored.walletAddress, walletAddress);
  assert.deepEqual(restored.privateJwk, await crypto.subtle.exportKey('jwk', identity.privateKey));
  assert.deepEqual(restored.publicJwk, identity.publicJwk);
});

test('a fresh-start encryption key can be backed up and restores to the same identity', async () => {
  const freshIdentity = await createIdentity();
  const backup = await createEncryptedIdentityBackupFile(walletAddress, freshIdentity, passphrase);
  const restored = await decryptEncryptedIdentityBackupFile(walletAddress, backup, passphrase);
  assert.deepEqual(restored.publicJwk, freshIdentity.publicJwk);
  assert.deepEqual(restored.privateJwk, await crypto.subtle.exportKey('jwk', freshIdentity.privateKey));

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    restored.privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    restored.publicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const probe = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const [fromPrivate, fromPublic] = await Promise.all([
    crypto.subtle.deriveBits({ name: 'ECDH', public: probe.publicKey }, privateKey, 256),
    crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, probe.privateKey, 256),
  ]);
  assert.deepEqual(new Uint8Array(fromPrivate), new Uint8Array(fromPublic));
});

test('recovery backup rejects a wrong passphrase and another wallet', async () => {
  const backup = await createEncryptedIdentityBackupFile(walletAddress, await createIdentity(), passphrase);
  await assert.rejects(
    decryptEncryptedIdentityBackupFile(walletAddress, backup, 'wrong recovery passphrase'),
    /passphrase is incorrect or the backup file is damaged/,
  );
  await assert.rejects(
    decryptEncryptedIdentityBackupFile('r222222222222222222222222222222222', backup, passphrase),
    /belongs to a different XRPL wallet/,
  );
});

test('recovery backup rejects unsupported files and weak passphrases', async () => {
  await assert.rejects(
    createEncryptedIdentityBackupFile(walletAddress, await createIdentity(), 'short'),
    /at least 12 characters/,
  );
  await assert.rejects(
    decryptEncryptedIdentityBackupFile(walletAddress, new Blob(['{}']), passphrase),
    /not a supported Frogtown encryption backup/,
  );
});
