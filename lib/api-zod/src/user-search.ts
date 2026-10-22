import { z } from "zod";

export const WalletUserSearchQuery = z.object({
  q: z.string().trim().min(4).max(43),
});

const WalletUserSearchResult = z.object({
  walletAddress: z.string().regex(/^(r[1-9A-HJ-NP-Za-km-z]{24,34}|0x[a-fA-F0-9]{40})$/),
  username: z.string().min(4).max(17).nullable(),
});

export const WalletUserSearchResponse = z.array(WalletUserSearchResult).max(10);
export type WalletUserSearchResult = z.infer<typeof WalletUserSearchResult>;
