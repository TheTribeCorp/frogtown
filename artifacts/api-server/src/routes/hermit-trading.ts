import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateHermitBuyPayloadBody,
  CreateHermitBuyPayloadResponse,
  CreateHermitTrustlinePayloadResponse,
  GetHermitBuyQuoteQueryParams,
  GetHermitBuyQuoteResponse,
  GetHermitTradeStatusParams,
  GetHermitTradeStatusResponse,
  GetWalletHermitBalanceQueryParams,
  GetWalletHermitBalanceResponse,
} from "@workspace/api-zod";
import { getWalletHermitBalance } from "../lib/hermit-tick";
import {
  buildHermitBuyTransaction,
  buildHermitTrustlineTransaction,
  createHermitXamanPayload,
  getHermitBuyQuote,
  HermitTradingError,
  validateHermitXrpAmount,
} from "../lib/hermit-trading";
import { requireAuth } from "./swamp";

const router: IRouter = Router();

type XamanPayloadStatus = {
  meta?: {
    resolved?: boolean;
    signed?: boolean;
    expired?: boolean;
  };
  custom_meta?: {
    identifier?: unknown;
  };
  response?: {
    account?: unknown;
    txid?: unknown;
  };
};

function sendTradingError(req: Request, res: Response, error: unknown) {
  if (error instanceof HermitTradingError) {
    if (error.statusCode >= 500) req.log.warn({ statusCode: error.statusCode }, error.message);
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, "Unexpected $HERMIT trade request failure.");
  res.status(503).json({ error: "$HERMIT trading is temporarily unavailable. Try again shortly." });
}

router.get("/wallet/hermit-balance", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

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

router.get("/wallet/hermit-buy-quote", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

  const query = GetHermitBuyQuoteQueryParams.safeParse({
    xrpAmount: req.query.xrpAmount,
    slippageBps: req.query.slippageBps ?? 500,
  });
  if (!query.success) {
    res.status(400).json({ error: "Enter a valid XRP amount and slippage between 0.5% and 20%." });
    return;
  }
  try {
    validateHermitXrpAmount(query.data.xrpAmount);
  } catch (error) {
    sendTradingError(req, res, error);
    return;
  }

  const balance = await getWalletHermitBalance(walletAddress);
  if (balance.checkStatus === "unavailable") {
    res.status(503).json({ error: "Frogtown could not verify your $HERMIT trustline. Try again shortly." });
    return;
  }
  if (!balance.trustlineExists) {
    res.status(409).json({ error: "Create the $HERMIT trustline before requesting a buy quote." });
    return;
  }

  try {
    const quote = await getHermitBuyQuote(query.data.xrpAmount, query.data.slippageBps);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(GetHermitBuyQuoteResponse.parse({
      xrpAmount: quote.xrpAmount,
      expectedHermit: quote.expectedHermit,
      minimumHermit: quote.minimumHermit,
      priceImpactPercent: quote.priceImpactPercent,
      slippageBps: quote.slippageBps,
      ammFeeBps: quote.ammFeeBps,
      xrpReserve: quote.xrpReserve,
      checkedAt: quote.checkedAt,
    }));
  } catch (error) {
    sendTradingError(req, res, error);
  }
});

router.post("/wallet/hermit-trustline", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

  const balance = await getWalletHermitBalance(walletAddress, true);
  if (balance.checkStatus === "unavailable") {
    res.status(503).json({ error: "Frogtown could not check your trustline. Try again shortly." });
    return;
  }
  if (balance.trustlineExists) {
    res.status(409).json({ error: "This wallet already has a $HERMIT trustline." });
    return;
  }

  try {
    const payload = await createHermitXamanPayload(
      "trustline",
      walletAddress,
      buildHermitTrustlineTransaction(),
      null,
    );
    res.status(201).json(CreateHermitTrustlinePayloadResponse.parse(payload));
  } catch (error) {
    sendTradingError(req, res, error);
  }
});

router.post("/wallet/hermit-buy", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

  const body = CreateHermitBuyPayloadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter an XRP amount from 0.01 to 1,000 and slippage between 0.5% and 20%." });
    return;
  }
  try {
    validateHermitXrpAmount(body.data.xrpAmount);
  } catch (error) {
    sendTradingError(req, res, error);
    return;
  }

  const balance = await getWalletHermitBalance(walletAddress, true);
  if (balance.checkStatus === "unavailable") {
    res.status(503).json({ error: "Frogtown could not verify your $HERMIT trustline. Try again shortly." });
    return;
  }
  if (!balance.trustlineExists) {
    res.status(409).json({ error: "Create the $HERMIT trustline before placing a buy order." });
    return;
  }

  try {
    const quote = await getHermitBuyQuote(body.data.xrpAmount, body.data.slippageBps);
    const payload = await createHermitXamanPayload(
      "buy",
      walletAddress,
      buildHermitBuyTransaction(quote),
      quote,
    );
    res.status(201).json(CreateHermitBuyPayloadResponse.parse(payload));
  } catch (error) {
    sendTradingError(req, res, error);
  }
});

router.get("/wallet/hermit-transactions/:payloadId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

  const params = GetHermitTradeStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid Xaman transaction reference." });
    return;
  }

  const apiKey = process.env.XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET;
  if (!apiKey || !apiSecret) {
    res.status(503).json({ error: "Xaman trading is not configured for this environment." });
    return;
  }

  try {
    const response = await fetch(
      `https://xumm.app/api/v1/platform/payload/${params.data.payloadId}`,
      {
        headers: { "X-API-Key": apiKey, "X-API-Secret": apiSecret },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (response.status === 404) {
      res.status(404).json({ error: "This Xaman request was not found for your wallet." });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ error: "Xaman could not confirm the transaction status." });
      return;
    }

    const payload = await response.json() as XamanPayloadStatus;
    const identifier = payload.custom_meta?.identifier;
    const identifierMatch = typeof identifier === "string"
      ? /^frogtown:hermit:(buy|trustline):([^:]+):[0-9a-f-]{36}$/i.exec(identifier)
      : null;
    if (!identifierMatch || identifierMatch[2] !== walletAddress) {
      res.status(404).json({ error: "This Xaman request was not found for your wallet." });
      return;
    }

    const transactionType = identifierMatch[1] as "buy" | "trustline";
    const resolved = payload.meta?.resolved === true;
    const signed = payload.meta?.signed === true;
    const signer = typeof payload.response?.account === "string"
      ? payload.response.account
      : null;
    let status: "pending" | "signed" | "rejected" | "expired" | "wallet_mismatch" = "pending";
    if (resolved && signed) {
      status = signer === walletAddress ? "signed" : "wallet_mismatch";
    } else if (resolved) {
      status = "rejected";
    } else if (payload.meta?.expired === true) {
      status = "expired";
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.json(GetHermitTradeStatusResponse.parse({
      payloadId: params.data.payloadId,
      transactionType,
      status,
      walletAddress: signer,
      txid: typeof payload.response?.txid === "string" ? payload.response.txid : null,
    }));
  } catch {
    res.status(502).json({ error: "Xaman could not confirm the transaction status." });
  }
});

export default router;
