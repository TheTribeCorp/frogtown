import type { Request, Response } from "express";
import app from "./app";
import { restoreVercelApiPath } from "./lib/vercel-path";

export default function handler(req: Request, res: Response) {
  const restoredUrl = restoreVercelApiPath(req.url);
  if (restoredUrl !== undefined) req.url = restoredUrl;
  app(req, res);
}
