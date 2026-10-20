import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { mobileAuthRequestsTable, nativePushDevicesTable } from "@workspace/db/schema";
import { z } from "zod";
import { getBrowserAuthenticatedWallet, requireAuth } from "./swamp";
import { createMobileSession } from "../lib/mobile-session";

const router = Router();
const uuid = z.string().uuid();
const challenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const verifier = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const pushToken = z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/);
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

router.post("/mobile/auth/requests", async (req, res): Promise<void> => {
  res.set(noStore);
  const parsed = z.object({ codeChallenge: challenge }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid app sign-in challenge is required." }); return; }
  const secret = process.env.VERCEL_ENV === "preview" ? process.env.PREVIEW_SESSION_SECRET : process.env.SESSION_SECRET;
  if (!secret) { res.status(503).json({ error: "Wallet sign-in is not configured." }); return; }
  try {
    // Vercel overwrites this platform header. Do not collapse all members onto
    // the reverse proxy's socket IP, or one busy proxy blocks every new login.
    const forwarded = process.env.VERCEL ? req.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
    const clientAddress = forwarded && isIP(forwarded) ? forwarded : req.ip;
    const clientHash = createHash("sha256").update(`${secret}:mobile:${clientAddress}`).digest("hex");
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${clientHash}))`);
      await tx.delete(mobileAuthRequestsTable).where(lt(mobileAuthRequestsTable.expiresAt, new Date()));
      const [count] = await tx.select({ n: sql<number>`count(*)::int` })
        .from(mobileAuthRequestsTable).where(eq(mobileAuthRequestsTable.clientHash, clientHash));
      if (count.n >= 60) return false;
      await tx.insert(mobileAuthRequestsTable).values({ id, codeChallenge: parsed.data.codeChallenge, clientHash, expiresAt });
      return true;
    });
    if (!created) { res.status(429).json({ error: "Too many sign-in attempts. Please wait five minutes." }); return; }
    // Relative path: the native client resolves this against its explicitly configured API origin.
    res.status(201).json({ requestId: id, loginPath: `/?mobileRequest=${id}`, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    req.log.error({ err: error }, "Could not start mobile sign-in");
    res.status(503).json({ error: "Mobile sign-in is temporarily unavailable." });
  }
});

router.post("/mobile/auth/requests/:requestId/approve", async (req, res): Promise<void> => {
  res.set(noStore);
  const wallet = getBrowserAuthenticatedWallet(req);
  if (!wallet) { res.status(401).json({ error: "Connect your wallet in this browser first." }); return; }
  const origin = req.get("origin");
  let sameOrigin = false;
  try {
    const parsedOrigin = new URL(origin || "");
    const localHttp = parsedOrigin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname);
    sameOrigin = (parsedOrigin.protocol === "https:" || localHttp)
      && parsedOrigin.origin === origin && parsedOrigin.host.toLowerCase() === req.get("host")?.toLowerCase();
  } catch { /* Invalid origins are rejected rather than reflected. */ }
  if (!sameOrigin) {
    res.status(403).json({ error: "Approve sign-in from the Frogtown website." }); return;
  }
  const id = uuid.safeParse(req.params.requestId);
  if (!id.success) { res.status(400).json({ error: "Invalid sign-in request." }); return; }
  try {
    const approved = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id.data}))`);
      const [request] = await tx.select().from(mobileAuthRequestsTable)
        .where(and(eq(mobileAuthRequestsTable.id, id.data), gt(mobileAuthRequestsTable.expiresAt, new Date())));
      if (!request || (request.walletAddress && request.walletAddress !== wallet)) return false;
      await tx.update(mobileAuthRequestsTable).set({ walletAddress: wallet }).where(eq(mobileAuthRequestsTable.id, id.data));
      return true;
    });
    if (!approved) { res.status(410).json({ error: "This request expired or was already approved by another wallet." }); return; }
    res.json({ approved: true });
  } catch (error) {
    req.log.error({ err: error }, "Could not approve mobile sign-in");
    res.status(503).json({ error: "Sign-in approval is temporarily unavailable." });
  }
});

router.post("/mobile/auth/exchange", async (req, res): Promise<void> => {
  res.set(noStore);
  const parsed = z.object({ requestId: uuid, codeVerifier: verifier }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid app sign-in proof." }); return; }
  try {
    const codeChallenge = createHash("sha256").update(parsed.data.codeVerifier).digest("base64url");
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${parsed.data.requestId}))`);
      const [request] = await tx.select().from(mobileAuthRequestsTable).where(and(
        eq(mobileAuthRequestsTable.id, parsed.data.requestId),
        eq(mobileAuthRequestsTable.codeChallenge, codeChallenge),
        gt(mobileAuthRequestsTable.expiresAt, new Date()),
      ));
      if (!request) return null;
      if (!request.walletAddress) return { status: "pending" as const };
      await tx.delete(mobileAuthRequestsTable).where(eq(mobileAuthRequestsTable.id, request.id));
      return { status: "connected" as const, walletAddress: request.walletAddress, ...createMobileSession(request.walletAddress) };
    });
    if (!result) { res.status(410).json({ error: "This sign-in expired or was already used. Start again in the app." }); return; }
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Could not exchange mobile sign-in");
    res.status(503).json({ error: "Mobile sign-in is temporarily unavailable." });
  }
});

router.get("/mobile/push/devices", async (req, res): Promise<void> => {
  const wallet = requireAuth(req, res); if (!wallet) return;
  res.set(noStore);
  try {
    const devices = await db.select({
      id: nativePushDevicesTable.id, platform: nativePushDevicesTable.platform,
      name: nativePushDevicesTable.name, createdAt: nativePushDevicesTable.createdAt, updatedAt: nativePushDevicesTable.updatedAt,
    }).from(nativePushDevicesTable).where(eq(nativePushDevicesTable.walletAddress, wallet));
    res.json(devices);
  } catch { res.status(503).json({ error: "Notification devices could not be loaded." }); }
});

router.post("/mobile/push/devices", async (req, res): Promise<void> => {
  const wallet = requireAuth(req, res); if (!wallet) return;
  const parsed = z.object({
    token: pushToken, platform: z.enum(["ios", "android"]), name: z.string().trim().min(1).max(60),
  }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid native notification device." }); return; }
  try {
    const device = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`native-push:${wallet}`}))`);
      const existing = await tx.select({ token: nativePushDevicesTable.token }).from(nativePushDevicesTable)
        .where(eq(nativePushDevicesTable.walletAddress, wallet));
      if (existing.length >= 10 && !existing.some((d) => d.token === parsed.data.token)) return null;
      const [saved] = await tx.insert(nativePushDevicesTable).values({ id: randomUUID(), walletAddress: wallet, ...parsed.data })
        .onConflictDoUpdate({ target: nativePushDevicesTable.token, set: { walletAddress: wallet, ...parsed.data, updatedAt: new Date() } })
        .returning({ id: nativePushDevicesTable.id });
      return saved;
    });
    if (!device) { res.status(429).json({ error: "Revoke an old device before adding another (maximum 10)." }); return; }
    res.status(201).json(device);
  } catch { res.status(503).json({ error: "This device could not be registered for alerts." }); }
});

router.delete("/mobile/push/devices/:deviceId", async (req, res): Promise<void> => {
  const wallet = requireAuth(req, res); if (!wallet) return;
  const id = uuid.safeParse(req.params.deviceId);
  if (!id.success) { res.status(400).json({ error: "Invalid notification device." }); return; }
  try {
    await db.delete(nativePushDevicesTable).where(and(
      eq(nativePushDevicesTable.id, id.data), eq(nativePushDevicesTable.walletAddress, wallet),
    ));
    res.status(204).send();
  } catch { res.status(503).json({ error: "This notification device could not be revoked." }); }
});

export default router;
