import { createHmac, timingSafeEqual } from "node:crypto";
import { isWalletIdentity as isWalletAddress, normalizeWalletIdentity as normalizeWalletAddress } from "./wallet-identity";

const AUDIENCE = "frogtown-native-v1";
export const MOBILE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret() {
  const value = process.env.VERCEL_ENV === "preview"
    ? process.env.PREVIEW_SESSION_SECRET : process.env.SESSION_SECRET;
  if (!value) throw new Error("Wallet sessions are not configured.");
  return value;
}

export function createMobileSession(walletAddress: string) {
  const expiresAt = Date.now() + MOBILE_SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    aud: AUDIENCE, walletAddress: normalizeWalletAddress(walletAddress), expiresAt,
  })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`${AUDIENCE}:${payload}`).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

export function readMobileSession(token: string): string | null {
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const [payload, signature] = parts;
    const expected = createHmac("sha256", secret()).update(`${AUDIENCE}:${payload}`).digest("base64url");
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.aud !== AUDIENCE || !Number.isFinite(parsed.expiresAt)
      || parsed.expiresAt <= Date.now() || !isWalletAddress(parsed.walletAddress)) return null;
    return normalizeWalletAddress(parsed.walletAddress);
  } catch {
    return null;
  }
}
