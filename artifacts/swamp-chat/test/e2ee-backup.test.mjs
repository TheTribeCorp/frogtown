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
