const XRPL_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function isXrplWalletAddress(value: string): boolean {
  return XRPL_ADDRESS.test(value);
}

export function isEvmWalletAddress(value: string): boolean {
  return EVM_ADDRESS.test(value);
}

export function isWalletIdentity(value: string): boolean {
  return isXrplWalletAddress(value) || isEvmWalletAddress(value);
}

export function normalizeWalletIdentity(value: string): string {
  return isEvmWalletAddress(value) ? value.toLowerCase() : value;
}
