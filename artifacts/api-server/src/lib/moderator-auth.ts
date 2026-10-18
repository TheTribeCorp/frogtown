import type { Response } from "express";

export function configuredModeratorWallets() {
  return new Set(
    (process.env.FROGTOWN_MODERATOR_WALLETS ?? "")
      .split(",")
      .map((wallet) => wallet.trim())
      .filter(Boolean),
  );
}

export function requireModerator(
  walletAddress: string,
  res: Response,
  activity = "review reports",
) {
  const moderators = configuredModeratorWallets();
  if (moderators.size === 0) {
    res.status(503).json({ error: "Moderator access is not configured." });
    return false;
  }
  if (!moderators.has(walletAddress)) {
    res.status(403).json({ error: `Only configured Frogtown moderators can ${activity}.` });
    return false;
  }
  return true;
}
