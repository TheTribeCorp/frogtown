import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = HealthCheckResponse.parse({ status: "ok", database: "ok" });
    res.json(data);
  } catch {
    const data = HealthCheckResponse.parse({
      status: "unavailable",
      database: "unavailable",
    });
    res.status(503).json(data);
  }
});

export default router;
