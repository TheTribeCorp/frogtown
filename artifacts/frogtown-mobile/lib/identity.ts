import * as Crypto from 'expo-crypto';
import { getWalletEncryptionKey, registerWalletEncryptionKey, resetWalletEncryptionKey } from '@workspace/api-client-react';
import { canonicalKey, generateIdentity, importBackup, type Identity } from './crypto';
import { readSecure, writeSecure, removeSecure, walletStorageKey } from './storage';
import { statusOf } from './api';
import { clearChatState } from './outbox';

export class RecoveryRequired extends Error {}
async function registeredKey(wallet: string) {
  try { return (await getWalletEncryptionKey(wallet)).publicKey; }
  catch (error) { if (statusOf(error) === 404) return null; throw error; }
}
export async function ensureIdentity(wallet: string): Promise<Identity> {
  const keyName = walletStorageKey(wallet);
  const [local, pending, remote] = await Promise.all([readSecure(keyName), readSecure(`${keyName}.pending`), registeredKey(wallet)]);
  if (pending) {
    const candidate = JSON.parse(pending) as Identity;
    if (canonicalKey(candidate.publicJwk) === remote) {
      if (local && canonicalKey((JSON.parse(local) as Identity).publicJwk) !== remote) await clearChatState(wallet);
      await writeSecure(keyName, pending); await removeSecure(`${keyName}.pending`);
      return candidate;
    }
  }
  const identity = local ? JSON.parse(local) as Identity : null;
  if (remote) {
    if (!identity || canonicalKey(identity.publicJwk) !== remote) throw new RecoveryRequired('Restore your encrypted Frogtown backup to read chats on this phone. We have not replaced your existing key.');
    return identity;
  }
  const created = identity ?? generateIdentity(Crypto.getRandomBytes);
  if (!identity) await writeSecure(keyName, JSON.stringify(created));
  try { await registerWalletEncryptionKey({ publicKey: canonicalKey(created.publicJwk) }); }
  catch (error) {
    if (statusOf(error) !== 409) throw error;
    if ((await registeredKey(wallet)) !== canonicalKey(created.publicJwk)) throw new RecoveryRequired('A different device key was registered. Restore your recovery file.');
  }
  return created;
}
export async function restoreIdentity(wallet: string, text: string, passphrase: string) {
  const identity = await importBackup(wallet, text, passphrase);
  const remote = await registeredKey(wallet);
  if (remote && canonicalKey(identity.publicJwk) !== remote) throw new Error('This backup does not match your wallet’s current encryption key.');
  // A matching registered backup can replace a stale device copy after a remote fresh start.
  if (!remote) await registerWalletEncryptionKey({ publicKey: canonicalKey(identity.publicJwk) });
  await writeSecure(walletStorageKey(wallet), JSON.stringify(identity));
  return identity;
}
export async function freshIdentity(wallet: string) {
  const identity = generateIdentity(Crypto.getRandomBytes);
  const key = walletStorageKey(wallet);
  await writeSecure(`${key}.pending`, JSON.stringify(identity));
  await resetWalletEncryptionKey({ publicKey: canonicalKey(identity.publicJwk) });
  await writeSecure(key, JSON.stringify(identity));
  await removeSecure(`${key}.pending`);
  return identity;
}
