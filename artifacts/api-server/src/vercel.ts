import type { Request, Response } from "express";
import app from "./app";

export default function handler(req: Request, res: Response) {
  app(req, res);
}
