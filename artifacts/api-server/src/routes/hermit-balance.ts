import { Router, type IRouter } from "express";
import {
  GetWalletHermitBalanceQueryParams,
  GetWalletHermitBalanceResponse,
} from "@workspace/api-zod";
import { getWalletHermitBalance } from "../lib/hermit-tick";
import { requireAuth } from "./swamp";

const router: IRouter = Router();

router.get("/wallet/hermit-balance", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(walletAddress)) {
    res.status(400).json({ error: "$HERMIT and XRP balance checks are available for XRPL wallets only." });
    return;
  }

  const rawRefresh = req.query.refresh;
  if (rawRefresh !== undefined && rawRefresh !== "true" && rawRefresh !== "false") {
    res.status(400).json({ error: "The refresh query must be true or false." });
    return;
  }
  const query = GetWalletHermitBalanceQueryParams.safeParse({
    refresh: rawRefresh === "true",
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid balance-check query." });
    return;
  }

  const check = await getWalletHermitBalance(walletAddress, query.data.refresh);
  if (check.checkStatus === "unavailable") {
    req.log.warn("XRPL $HERMIT balance lookup is temporarily unavailable.");
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetWalletHermitBalanceResponse.parse(check));
});

export default router;
