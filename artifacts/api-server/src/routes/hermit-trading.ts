import { Router, type IRouter, type Request, type Response } from "express";
import { gte, lt, sql } from "drizzle-orm";
import {
  CreateHermitBuyFunnelEventBody,
  GetHermitBuyFunnelQueryParams,
  GetHermitBuyFunnelResponse,
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
import { db, hermitBuyFunnelDailyTable } from "@workspace/db";
import { getWalletHermitBalance } from "../lib/hermit-tick";
import {
  buildHermitBuyTransaction,
  buildHermitTrustlineTransaction,
  createHermitXamanPayload,
  getHermitBuyLedgerOutcome,
  getHermitBuyQuote,
  HermitTradingError,
  validateHermitXrpAmount,
} from "../lib/hermit-trading";
import { requireModerator } from "../lib/moderator-auth";
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

const FUNNEL_EVENT_NAMES = [
  "quote_preview",
  "trustline_approval",
  "buy_approval",
  "buy_completed",
  "buy_unfilled",
  "buy_failed",
  "buy_rejected",
  "buy_expired",
  "buy_wallet_mismatch",
  "trustline_rejected",
  "trustline_expired",
  "trustline_wallet_mismatch",
] as const;

function utcDayOffset(daysAgo: number) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day.toISOString().slice(0, 10);
}

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
    let status: "pending" | "signed" | "completed" | "unfilled" | "failed" | "rejected" | "expired" | "wallet_mismatch" = "pending";
    let receivedHermit: string | null = null;
    if (resolved && signed) {
      status = signer === walletAddress ? "signed" : "wallet_mismatch";
      if (transactionType === "buy" && status === "signed" && typeof payload.response?.txid === "string") {
        const ledgerOutcome = await getHermitBuyLedgerOutcome(payload.response.txid, walletAddress);
        if (ledgerOutcome) {
          status = ledgerOutcome.status;
          if (ledgerOutcome.status === "completed") receivedHermit = ledgerOutcome.receivedHermit;
        }
      }
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
      receivedHermit,
      walletAddress: signer,
      txid: typeof payload.response?.txid === "string" ? payload.response.txid : null,
    }));
  } catch {
    res.status(502).json({ error: "Xaman could not confirm the transaction status." });
  }
});

router.post("/wallet/hermit-buy-funnel-events", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

  const body = CreateHermitBuyFunnelEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Unsupported purchase-flow event." });
    return;
  }

  const eventDay = utcDayOffset(0);
  const retentionCutoff = utcDayOffset(90);
  await db.delete(hermitBuyFunnelDailyTable)
    .where(lt(hermitBuyFunnelDailyTable.eventDay, retentionCutoff));
  await db.insert(hermitBuyFunnelDailyTable)
    .values({ eventDay, event: body.data.event, eventCount: 1 })
    .onConflictDoUpdate({
      target: [hermitBuyFunnelDailyTable.eventDay, hermitBuyFunnelDailyTable.event],
      set: { eventCount: sql`${hermitBuyFunnelDailyTable.eventCount} + 1` },
    });
  res.status(204).end();
});

router.get("/wallet/hermit-buy-funnel", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  if (!requireModerator(walletAddress, res, "view purchase-flow analytics")) return;

  const parsed = GetHermitBuyFunnelQueryParams.safeParse({
    days: req.query.days === undefined ? 30 : Number(req.query.days),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a funnel reporting window of 7, 30, or 90 days." });
    return;
  }

  const cutoff = utcDayOffset(parsed.data.days - 1);
  const rows = await db
    .select({
      event: hermitBuyFunnelDailyTable.event,
      count: sql<number>`sum(${hermitBuyFunnelDailyTable.eventCount})::integer`,
    })
    .from(hermitBuyFunnelDailyTable)
    .where(gte(hermitBuyFunnelDailyTable.eventDay, cutoff))
    .groupBy(hermitBuyFunnelDailyTable.event);
  const totalsByEvent = new Map(rows.map((row) => [row.event, Number(row.count)]));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetHermitBuyFunnelResponse.parse({
    days: parsed.data.days,
    totals: FUNNEL_EVENT_NAMES.map((event) => ({ event, count: totalsByEvent.get(event) ?? 0 })),
  }));
});

export default router;
