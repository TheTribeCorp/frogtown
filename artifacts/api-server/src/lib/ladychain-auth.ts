export const LADYCHAIN_CHAIN_ID = 589;

export function createLadyChainSignInMessage(
  origin: string,
  walletAddress: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
): string {
  return [
    `${new URL(origin).host} wants you to sign in to Frogtown with your LadyChain wallet:`,
    walletAddress,
    "",
    "Sign in to Frogtown. This signature does not send a transaction or move funds.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    `Chain ID: ${LADYCHAIN_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}
