import { Router, type IRouter } from "express";
import { GetHermitMarketDataResponse } from "@workspace/api-zod";
import { getHermitMarketData } from "../lib/hermit-market";

const router: IRouter = Router();

router.get("/hermit/market-data", async (req, res): Promise<void> => {
  try {
    const marketData = await getHermitMarketData();
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.json(GetHermitMarketDataResponse.parse(marketData));
  } catch (error) {
    req.log.warn({ err: error }, "Could not load $HERMIT market data.");
    res.status(503).json({ error: "$HERMIT market data is temporarily unavailable." });
  }
});

export default router;
