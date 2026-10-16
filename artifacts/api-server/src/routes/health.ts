import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

function getDatabaseFailureCategory(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  if (code === "28P01" || code === "28000") return "credentials";
  if (code === "53300") return "capacity";
  if (code === "3D000") return "database";
  if (code === "57P03") return "unavailable";
  if (
    code.startsWith("08") ||
    ["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  ) {
    return "connectivity";
  }
  return "unknown";
}

router.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = HealthCheckResponse.parse({ status: "ok", database: "ok" });
    res.json(data);
  } catch (error) {
    const category = getDatabaseFailureCategory(error);
    // Avoid logging error messages because drivers can include connection details.
    console.error("Frogtown database health check failed", { category });
    res.setHeader("x-frogtown-database-health", category);
    const data = HealthCheckResponse.parse({
      status: "unavailable",
      database: "unavailable",
    });
    res.status(503).json(data);
  }
});

export default router;
