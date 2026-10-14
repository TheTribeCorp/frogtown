export type ConversationEncryptionKey = {
  walletAddress: string;
  publicKey: string | null;
};

export type ConversationKeyChange = {
  walletAddress: string;
  publicKey: string;
};

export type EncryptionKeyPinStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "frogtown-e2ee-key-pins:v1:";

function storageKey(walletAddress: string) {
  return `${STORAGE_PREFIX}${walletAddress}`;
}

function readPins(walletAddress: string, storage: EncryptionKeyPinStorage): Record<string, string> {
  const saved = storage.getItem(storageKey(walletAddress));
  if (!saved) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error("Saved encryption-key history is unreadable.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Saved encryption-key history is invalid.");
  }

  const pins: Record<string, string> = {};
  for (const [address, publicKey] of Object.entries(parsed)) {
    if (typeof publicKey !== "string") {
      throw new Error("Saved encryption-key history is invalid.");
    }
    pins[address] = publicKey;
  }
  return pins;
}

export function getConversationKeyChanges(
  walletAddress: string,
  members: readonly ConversationEncryptionKey[],
  storage: EncryptionKeyPinStorage,
): ConversationKeyChange[] {
  const pins = readPins(walletAddress, storage);
  const changes: ConversationKeyChange[] = [];
  let hasNewPins = false;

  for (const member of members) {
    if (member.walletAddress === walletAddress || !member.publicKey) continue;
    const remembered = pins[member.walletAddress];
    if (!remembered) {
      pins[member.walletAddress] = member.publicKey;
      hasNewPins = true;
      continue;
    }
    if (remembered !== member.publicKey) {
      changes.push({ walletAddress: member.walletAddress, publicKey: member.publicKey });
    }
  }

  if (hasNewPins) {
    storage.setItem(storageKey(walletAddress), JSON.stringify(pins));
  }
  return changes;
}

export function trustConversationKeyChange(
  walletAddress: string,
  memberWalletAddress: string,
  publicKey: string,
  storage: EncryptionKeyPinStorage,
): void {
  if (!publicKey) throw new Error("A current public encryption key is required.");
  const pins = readPins(walletAddress, storage);
  pins[memberWalletAddress] = publicKey;
  storage.setItem(storageKey(walletAddress), JSON.stringify(pins));
}
