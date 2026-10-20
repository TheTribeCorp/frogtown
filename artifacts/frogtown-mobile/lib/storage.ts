import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { pkceChallenge } from './crypto';

// Web preview is intentionally ephemeral. Native secrets never use AsyncStorage.
const preview = new Map<string, string>();
export function walletStorageKey(wallet: string) { return `frogtown.key.${pkceChallenge(wallet)}`; }
export async function readSecure(key: string) {
  return Platform.OS === 'web' ? preview.get(key) ?? null : SecureStore.getItemAsync(key);
}
export async function writeSecure(key: string, value: string) {
  if (Platform.OS === 'web') { preview.set(key, value); return; }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function removeSecure(key: string) {
  if (Platform.OS === 'web') { preview.delete(key); return; }
  await SecureStore.deleteItemAsync(key);
}
