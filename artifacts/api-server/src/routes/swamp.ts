import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  AcceptConversationRequestParams,
  BlockWalletBody,
  CreateDirectConversationBody,
  CreateConversationHistoryShareBody,
  CreateConversationHistoryShareParams,
  DeclineConversationRequestParams,
  CreateGroupBody,
  GetConversationEncryptionKeysParams,
  GetWalletHermitTickParams,
  GetWalletHermitTickQueryParams,
  GetWalletHermitTickResponse,
  GetWalletEncryptionKeyParams,
  GetWalletSessionParams,
  JoinGroupBody,
  JoinGroupParams,
  MarkConversationReadBody,
  MarkConversationReadParams,
  ListConversationMessagesParams,
  ListConversationMessagesQueryParams,
  ListConversationHistoryShareWorkParams,
  ListConversationHistorySharesParams,
  ListConversationsQueryParams,
  ListGroupsQueryParams,
  ListPushSubscriptionsResponse,
  RegisterWalletEncryptionKeyBody,
  ResetWalletEncryptionKeyBody,
  RevokePushSubscriptionParams,
  SendMessageBody,
  SendMessageParams,
  UnblockWalletParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { publishConversationUpdated, publishMessageCreated, publishMessageRead, subscribeToWalletMessages, type WalletEvent } from "../lib/message-events";
import { recordDailyQuestActionInTransaction } from "../lib/gamification";
import { getWalletHermitTick, hermitTickCacheControl } from "../lib/hermit-tick";
import {
  conversationMembersTable,
  conversationsTable,
  blockedWalletsTable,
  groupMembersTable,
  groupsTable,
  messagesTable,
  messageHistorySharesTable,
  walletKeysTable,
} from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { isWebPushConfigured, sendNewMessagePush } from "../lib/web-push";

const router: IRouter = Router();

let groupSeedPromise: Promise<void> | undefined;
// A cookie-name version bump invalidates stateless sessions without rotating
// environment secrets. Existing browsers must connect their wallet again.
const AUTH_COOKIE = "swamp_session_v2";
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PUSH_SUBSCRIPTIONS_PER_WALLET = 8;

const isWalletAddress = (value: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);

function isPublicEncryptionKey(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.kty === "EC"
      && parsed.crv === "P-256"
      && typeof parsed.x === "string"
      && typeof parsed.y === "string"
      && !("d" in parsed);
  } catch {
    return false;
  }
}

function parsePushSubscription(value: unknown): {
  endpoint: string;
  p256dh: string;
  auth: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const subscription = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    typeof subscription.endpoint !== "string"
    || subscription.endpoint.length > 2048
    || typeof subscription.keys?.p256dh !== "string"
    || typeof subscription.keys.auth !== "string"
    || subscription.keys.p256dh.length > 256
    || subscription.keys.auth.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(subscription.keys.p256dh)
    || !/^[A-Za-z0-9_-]+$/.test(subscription.keys.auth)
  ) return null;

  try {
    const endpoint = new URL(subscription.endpoint);
    const host = endpoint.hostname.toLowerCase();
    const allowedPushHost = host === "fcm.googleapis.com"
      || host === "push.services.mozilla.com"
      || host.endsWith(".push.services.mozilla.com")
      || host === "web.push.apple.com"
      || host.endsWith(".notify.windows.com");
    if (
      endpoint.protocol !== "https:"
      || endpoint.username
      || endpoint.password
      || !allowedPushHost
    ) return null;
  } catch {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };
}

router.get("/push/vapid-public-key", (_req, res): void => {
  const publicKey = process.env.FROGTOWN_VAPID_PUBLIC_KEY;
  if (!isWebPushConfigured() || !publicKey) {
    res.json({ enabled: false });
    return;
  }
  res.json({ enabled: true, publicKey });
});

router.get("/push/subscriptions", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  try {
    const subscriptions = await db
      .select({
        endpoint: pushSubscriptionsTable.endpoint,
        createdAt: pushSubscriptionsTable.createdAt,
        updatedAt: pushSubscriptionsTable.updatedAt,
      })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.walletAddress, walletAddress))
      .orderBy(desc(pushSubscriptionsTable.updatedAt), desc(pushSubscriptionsTable.createdAt));
    res.json(ListPushSubscriptionsResponse.parse({
      subscriptions: subscriptions.map((subscription) => ({
        id: createHash("sha256").update(subscription.endpoint).digest("hex"),
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      })),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not list notification devices");
    res.status(500).json({ error: "Notification devices could not be loaded." });
  }
});

router.post("/push/subscriptions", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  if (!isWebPushConfigured()) {
    res.status(503).json({ error: "Background notifications are not configured for this Frogtown deployment." });
    return;
  }
  const subscription = parsePushSubscription(req.body);
  if (!subscription) {
    res.status(400).json({ error: "This browser push subscription is invalid or unsupported." });
    return;
  }

  try {
    const existing = await db
      .select({ endpoint: pushSubscriptionsTable.endpoint })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.walletAddress, walletAddress));
    if (
      !existing.some((item) => item.endpoint === subscription.endpoint)
      && existing.length >= MAX_PUSH_SUBSCRIPTIONS_PER_WALLET
    ) {
      res.status(429).json({ error: "This wallet already has the maximum number of notification devices." });
      return;
    }
    await db.insert(pushSubscriptionsTable)
      .values({ ...subscription, walletAddress })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          walletAddress,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          updatedAt: new Date(),
        },
      });
    res.status(201).json({ registered: true });
  } catch (error) {
    req.log.error({ err: error }, "Could not save a browser push subscription");
    res.status(500).json({ error: "This device could not be registered for notifications." });
  }
});

router.delete("/push/subscriptions", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint || endpoint.length > 2048) {
    res.status(400).json({ error: "The browser push subscription is invalid." });
    return;
  }
  try {
    await db.delete(pushSubscriptionsTable)
      .where(and(
        eq(pushSubscriptionsTable.walletAddress, walletAddress),
        eq(pushSubscriptionsTable.endpoint, endpoint),
      ));
    res.status(204).send();
  } catch (error) {
    req.log.error({ err: error }, "Could not remove a browser push subscription");
    res.status(500).json({ error: "This device could not be removed from notifications." });
  }
});

router.delete("/push/subscriptions/:subscriptionId", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const params = RevokePushSubscriptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The notification-device identifier is invalid." });
    return;
  }
  try {
    const ownedSubscriptions = await db
      .select({ endpoint: pushSubscriptionsTable.endpoint })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.walletAddress, walletAddress));
    const ownedDevice = ownedSubscriptions.find(
      (subscription) => createHash("sha256").update(subscription.endpoint).digest("hex") === params.data.subscriptionId,
    );
    if (ownedDevice) {
      await db.delete(pushSubscriptionsTable)
        .where(and(
          eq(pushSubscriptionsTable.walletAddress, walletAddress),
          eq(pushSubscriptionsTable.endpoint, ownedDevice.endpoint),
        ));
    }
    // Do not reveal whether an unknown id belongs to another wallet.
    res.status(204).send();
  } catch (error) {
    req.log.error({ err: error }, "Could not revoke a notification device");
    res.status(500).json({ error: "This device could not be removed from notifications." });
  }
});

type EventCursor = {
  messageAt: string;
  messageId: string;
  readAt: string;
  readConversationId: string;
};

function decodeEventCursor(value: string | undefined): EventCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EventCursor>;
    if (
      typeof parsed.messageAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.messageAt)) ||
      typeof parsed.messageId !== "string" ||
      typeof parsed.readAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.readAt)) ||
      (parsed.readConversationId !== undefined && typeof parsed.readConversationId !== "string")
    ) {
      return null;
    }
    return {
      messageAt: parsed.messageAt,
      messageId: parsed.messageId,
      readAt: parsed.readAt,
      readConversationId: parsed.readConversationId ?? "",
    };
  } catch {
    return null;
  }
}

function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function serializeConversation(
  row: typeof conversationsTable.$inferSelect,
  otherWalletAddress: string | null = null,
  directMessagingBlocked = false,
) {
  const title = row.type === "direct" && otherWalletAddress
    ? otherWalletAddress
    : row.title;
  return {
    ...row,
    title,
    participantLabel: row.type === "direct" && otherWalletAddress
      ? otherWalletAddress
      : row.participantLabel,
    lastMessage: row.lastMessage ? "Encrypted message" : null,
    directStatus: row.directStatus ?? "accepted",
    requesterAddress: row.requesterAddress ?? null,
    otherWalletAddress: row.type === "direct" ? otherWalletAddress : null,
    directMessagingBlocked: row.type === "direct" && directMessagingBlocked,
  };
}

function directPairLockKey(walletA: string, walletB: string): string {
  return [walletA, walletB].sort().join(":");
}

function decodeCanonicalBase64Url(value: unknown): Buffer | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

function hasValidRecipientEnvelope(body: string, memberWallets: string[]): boolean {
  const prefix = "e2ee:v1:";
  if (!body.startsWith(prefix)) return false;
  const encodedEnvelope = decodeCanonicalBase64Url(body.slice(prefix.length));
  if (!encodedEnvelope) return false;

  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encodedEnvelope));
  } catch {
    return false;
  }
  if (
    typeof envelope !== "object"
    || envelope === null
    || Array.isArray(envelope)
    || !("version" in envelope)
    || envelope.version !== 1
    || !("entries" in envelope)
    || typeof envelope.entries !== "object"
    || envelope.entries === null
    || Array.isArray(envelope.entries)
  ) {
    return false;
  }

  const entries = envelope.entries as Record<string, unknown>;
  const expectedWallets = new Set(memberWallets);
  const recipientWallets = Object.keys(entries);
  if (
    recipientWallets.length !== expectedWallets.size
    || recipientWallets.some((walletAddress) => !expectedWallets.has(walletAddress))
  ) {
    return false;
  }

  return recipientWallets.every((walletAddress) => {
    const entry = entries[walletAddress];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const cipherEntry = entry as Record<string, unknown>;
    const iv = decodeCanonicalBase64Url(cipherEntry.iv);
    const ciphertext = decodeCanonicalBase64Url(cipherEntry.ciphertext);
    return iv?.length === 12 && ciphertext !== null && ciphertext.length >= 16;
  });
}

function envelopeIncludesRecipient(body: string, walletAddress: string): boolean {
  const prefix = "e2ee:v1:";
  if (!body.startsWith(prefix)) return false;
  const encodedEnvelope = decodeCanonicalBase64Url(body.slice(prefix.length));
  if (!encodedEnvelope) return false;
  try {
    const envelope: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encodedEnvelope));
    if (
      typeof envelope !== "object"
      || envelope === null
      || Array.isArray(envelope)
      || !("version" in envelope)
      || envelope.version !== 1
      || !("entries" in envelope)
      || typeof envelope.entries !== "object"
      || envelope.entries === null
      || Array.isArray(envelope.entries)
    ) return false;
    const entry = (envelope.entries as Record<string, unknown>)[walletAddress];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const cipherEntry = entry as Record<string, unknown>;
    const iv = decodeCanonicalBase64Url(cipherEntry.iv);
    const ciphertext = decodeCanonicalBase64Url(cipherEntry.ciphertext);
    return iv?.length === 12 && ciphertext !== null && ciphertext.length >= 16;
  } catch {
    return false;
  }
}

async function ensureSeedGroups() {
  if (!groupSeedPromise) {
    groupSeedPromise = (async () => {
      const existing = await db.select({ id: groupsTable.id }).from(groupsTable).limit(1);
      if (existing.length > 0) return;

      const creatorAddress = "rSWAMP7b6Wc4tqZ6eVnVwN5xkC9sW6";
      const seedGroups = [
        {
          id: `group-${randomUUID()}`,
          conversationId: `conversation-${randomUUID()}`,
          name: "The Green Room",
          description: "Low-noise XRPL talk, alpha, and swamp lore.",
          memberCount: 0,
          onlineCount: 0,
          creatorAddress,
        },
        {
          id: `group-${randomUUID()}`,
          conversationId: `conversation-${randomUUID()}`,
          name: "Trencher Radio",
          description: "Market chatter for people who keep shipping.",
          memberCount: 0,
          onlineCount: 0,
          creatorAddress,
        },
      ];

      for (const group of seedGroups) {
        await db.insert(groupsTable).values(group);
        await db.insert(conversationsTable).values({
          id: group.conversationId,
          type: "group",
          title: group.name,
          participantLabel: "0 members",
          encrypted: true,
          memberCount: group.memberCount,
        });
      }
    })();
  }
  await groupSeedPromise;
}

function requireAddress(value: string) {
  if (!isWalletAddress(value)) {
    throw new Error("Enter a valid XRPL wallet address.");
  }
  return value;
}

function sessionSecret() {
  if (process.env.VERCEL_ENV === "preview") {
    return process.env.PREVIEW_SESSION_SECRET;
  }
  return process.env.SESSION_SECRET;
}

function encodeSession(walletAddress: string) {
  const expiresAt = Date.now() + AUTH_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ walletAddress, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret() ?? "").update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readCookie(req: Request) {
  const cookies = req.headers.cookie?.split(";") ?? [];
  const match = cookies.find((cookie) => cookie.trim().startsWith(`${AUTH_COOKIE}=`));
  return match ? decodeURIComponent(match.trim().slice(AUTH_COOKIE.length + 1)) : null;
}

function getAuthenticatedWallet(req: Request) {
  const token = readCookie(req);
  const secret = sessionSecret();
  if (!token || !secret) return null;

  const [payload, encodedSignature] = token.split(".");
  if (!payload || !encodedSignature) return null;
  try {
    const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
    const actual = Buffer.from(encodedSignature);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      walletAddress?: string;
      expiresAt?: number;
    };
    if (!parsed.walletAddress || !parsed.expiresAt || parsed.expiresAt <= Date.now()) return null;
    return isWalletAddress(parsed.walletAddress) ? parsed.walletAddress : null;
  } catch {
    return null;
  }
}

function setAuthCookie(res: Response, walletAddress: string) {
  res.cookie(AUTH_COOKIE, encodeSession(walletAddress), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: AUTH_TTL_MS,
    path: "/",
  });
}

export function requireAuth(req: Request, res: Response) {
  const walletAddress = getAuthenticatedWallet(req);
  if (!walletAddress) {
    res.status(401).json({ error: "Your wallet session has expired. Connect with Xaman again." });
    return null;
  }
  return walletAddress;
}

function requireMatchingWallet(sessionWallet: string, claimedWallet: string, res: Response) {
  if (sessionWallet !== claimedWallet) {
    res.status(403).json({ error: "This wallet is not the authenticated wallet." });
    return false;
  }
  return true;
}

router.post("/wallet/sessions", async (_req, res) => {
  const apiKey = process.env.XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET;
  if (!apiKey || !apiSecret || !sessionSecret()) {
    res.status(503).json({ error: "Xaman is not configured for this environment." });
    return;
  }

  try {
    const response = await fetch("https://xumm.app/api/v1/platform/payload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
      },
      body: JSON.stringify({
        txjson: { TransactionType: "SignIn" },
        options: { submit: false, expire: 5 },
      }),
    });

    if (!response.ok) {
      res.status(502).json({ error: "Xaman could not create a connection session." });
      return;
    }

    const payload = (await response.json()) as {
      uuid?: string;
      refs?: { qr_png?: string };
      next?: { always?: string };
    };
    if (!payload.uuid || !payload.refs?.qr_png || !payload.next?.always) {
      res.status(502).json({ error: "Xaman returned an incomplete connection session." });
      return;
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    res.status(201).json({
      sessionId: payload.uuid,
      qrUrl: payload.refs.qr_png,
      deeplink: payload.next.always,
      expiresAt,
    });
  } catch {
    res.status(502).json({ error: "Xaman could not be reached. Try again." });
  }
});

router.get("/wallet/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = GetWalletSessionParams.parse(req.params);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      res.status(400).json({ error: "Invalid wallet session." });
      return;
    }
    const apiKey = process.env.XAMAN_API_KEY;
    const apiSecret = process.env.XAMAN_API_SECRET;
    if (!apiKey || !apiSecret) {
      res.status(503).json({ error: "Xaman is not configured for this environment." });
      return;
    }

    const response = await fetch(`https://xumm.app/api/v1/platform/payload/${sessionId}`, {
      headers: { "X-API-Key": apiKey ?? "", "X-API-Secret": apiSecret ?? "" },
    });
    if (!response.ok) {
      res.status(502).json({ error: "Xaman could not be reached." });
      return;
    }

    const payload = (await response.json()) as {
      meta?: { resolved?: boolean; signed?: boolean; expired?: boolean };
      response?: { account?: string };
    };
    if (payload.meta?.expired === true) {
      res.json({ sessionId, status: "expired", walletAddress: null, network: "XRPL Mainnet" });
      return;
    }
    const walletAddress = payload.response?.account ?? null;
    const connected = payload.meta?.resolved === true && payload.meta?.signed === true && walletAddress;
    if (connected) {
      requireAddress(walletAddress);
      setAuthCookie(res, walletAddress);
    }
    res.json({
      sessionId,
      status: connected ? "connected" : "pending",
      walletAddress,
      network: "XRPL Mainnet",
    });
  } catch {
    res.status(400).json({ error: "Invalid wallet session." });
  }
});

router.get("/wallets/:walletAddress/hermit-tick", async (req, res): Promise<void> => {
  const parsedParams = GetWalletHermitTickParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Enter a valid XRPL wallet address." });
    return;
  }

  const rawRefresh = req.query.refresh;
  if (rawRefresh !== undefined && rawRefresh !== "true" && rawRefresh !== "false") {
    res.status(400).json({ error: "The refresh query must be true or false." });
    return;
  }
  const parsedQuery = GetWalletHermitTickQueryParams.safeParse({
    refresh: rawRefresh === "true",
  });
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid tick-check query." });
    return;
  }
  if (parsedQuery.data.refresh) {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    if (!requireMatchingWallet(sessionWallet, parsedParams.data.walletAddress, res)) return;
  }

  const check = await getWalletHermitTick(
    parsedParams.data.walletAddress,
    parsedQuery.data.refresh,
  );
  if (check.checkStatus === "unavailable") {
    req.log.warn("XRPL $HERMIT holder check is temporarily unavailable.");
  }
  res.setHeader("Cache-Control", hermitTickCacheControl(check.checkStatus, parsedQuery.data.refresh));
  res.json(GetWalletHermitTickResponse.parse(check));
});

router.get("/wallet/me", (req, res) => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  res.json({ walletAddress, network: "XRPL Mainnet" });
});

router.post("/wallet/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  res.status(204).send();
});

router.get("/wallet/blocks", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const blocked = await db
    .select()
    .from(blockedWalletsTable)
    .where(eq(blockedWalletsTable.walletAddress, walletAddress))
    .orderBy(desc(blockedWalletsTable.createdAt));
  res.json(blocked);
});

router.post("/wallet/blocks", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsed = BlockWalletBody.safeParse(req.body);
  if (!parsed.success || !isWalletAddress(parsed.data.blockedWalletAddress)) {
    res.status(400).json({ error: "Enter a valid XRPL wallet address to block." });
    return;
  }
  const blockedWalletAddress = parsed.data.blockedWalletAddress;
  if (walletAddress === blockedWalletAddress) {
    res.status(400).json({ error: "You cannot block your own wallet." });
    return;
  }

  try {
    const result = await db.transaction(async (transaction) => {
      const pairKey = directPairLockKey(walletAddress, blockedWalletAddress);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);
      const inserted = await transaction
        .insert(blockedWalletsTable)
        .values({ walletAddress, blockedWalletAddress })
        .onConflictDoNothing()
        .returning();
      const block = inserted[0] ?? (await transaction
        .select()
        .from(blockedWalletsTable)
        .where(and(
          eq(blockedWalletsTable.walletAddress, walletAddress),
          eq(blockedWalletsTable.blockedWalletAddress, blockedWalletAddress),
        ))
        .limit(1))[0];
      if (!block) throw new Error("Block record could not be saved.");

      const candidateRows = await transaction
        .select({
          conversationId: conversationsTable.id,
          walletAddress: conversationMembersTable.walletAddress,
        })
        .from(conversationsTable)
        .innerJoin(
          conversationMembersTable,
          eq(conversationsTable.id, conversationMembersTable.conversationId),
        )
        .where(and(
          eq(conversationsTable.type, "direct"),
          inArray(conversationMembersTable.walletAddress, [walletAddress, blockedWalletAddress]),
        ));
      const membersByConversation = new Map<string, Set<string>>();
      for (const row of candidateRows) {
        const members = membersByConversation.get(row.conversationId) ?? new Set<string>();
        members.add(row.walletAddress);
        membersByConversation.set(row.conversationId, members);
      }
      const exactPairIds = [...membersByConversation.entries()]
        .filter(([, members]) => members.size === 2)
        .map(([conversationId]) => conversationId);
      return { block, conversationIds: exactPairIds };
    });

    for (const conversationId of result.conversationIds) {
      await publishConversationUpdated(
        [walletAddress, blockedWalletAddress],
        { conversationId },
      );
    }
    res.status(201).json(result.block);
  } catch {
    res.status(500).json({ error: "This wallet could not be blocked right now." });
  }
});

router.delete("/wallet/blocks/:blockedWalletAddress", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsed = UnblockWalletParams.safeParse(req.params);
  if (!parsed.success || !isWalletAddress(parsed.data.blockedWalletAddress)) {
    res.status(400).json({ error: "Enter a valid XRPL wallet address." });
    return;
  }
  const blockedWalletAddress = parsed.data.blockedWalletAddress;
  if (walletAddress === blockedWalletAddress) {
    res.status(400).json({ error: "Invalid blocked wallet." });
    return;
  }
  try {
    await db.transaction(async (transaction) => {
      const pairKey = directPairLockKey(walletAddress, blockedWalletAddress);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);
      await transaction
        .delete(blockedWalletsTable)
        .where(and(
          eq(blockedWalletsTable.walletAddress, walletAddress),
          eq(blockedWalletsTable.blockedWalletAddress, blockedWalletAddress),
        ));
    });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "This wallet could not be unblocked right now." });
  }
});

router.get("/events", (req, res): void => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");

  if (process.env.VERCEL) {
    const now = new Date();
    const hasResumeCursor = Boolean(req.get("Last-Event-ID"));
    const cursor = decodeEventCursor(req.get("Last-Event-ID")) ?? {
      messageAt: now.toISOString(),
      messageId: "",
      readAt: now.toISOString(),
      readConversationId: "",
    };
    const overlapFloor = hasResumeCursor
      ? new Date(Date.parse(cursor.messageAt) - 5_000)
      : new Date(now.getTime() - 5_000);
    const seenMessageIds = new Set<string>();
    const seenMessageOrder: string[] = [];
    const rememberMessage = (messageId: string): boolean => {
      if (seenMessageIds.has(messageId)) return false;
      seenMessageIds.add(messageId);
      seenMessageOrder.push(messageId);
      if (seenMessageOrder.length > 2_000) {
        const expiredId = seenMessageOrder.shift();
        if (expiredId) seenMessageIds.delete(expiredId);
      }
      return true;
    };
    let pollInFlight = false;
    let cleanedUp = false;

    const send = (event: WalletEvent) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`id: ${encodeEventCursor(cursor)}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const poll = async () => {
      if (pollInFlight || cleanedUp) return;
      pollInFlight = true;
      try {
        const messageAt = new Date(cursor.messageAt);
        const overlapAt = new Date(Math.max(overlapFloor.getTime(), messageAt.getTime() - 5_000));
        const messageCursorCondition = or(
          gt(messagesTable.sentAt, messageAt),
          and(
            eq(messagesTable.sentAt, messageAt),
            gt(messagesTable.id, cursor.messageId),
          ),
          gte(messagesTable.sentAt, overlapAt),
        );
        const knownMessageIds = [...seenMessageIds];
        const messages = await db
          .select({
            id: messagesTable.id,
            conversationId: messagesTable.conversationId,
            senderAddress: messagesTable.senderAddress,
            sentAt: messagesTable.sentAt,
            conversationType: conversationsTable.type,
            directStatus: conversationsTable.directStatus,
          })
          .from(messagesTable)
          .innerJoin(
            conversationsTable,
            eq(messagesTable.conversationId, conversationsTable.id),
          )
          .innerJoin(
            conversationMembersTable,
            and(
              eq(messagesTable.conversationId, conversationMembersTable.conversationId),
              eq(conversationMembersTable.walletAddress, walletAddress),
            ),
          )
          .where(knownMessageIds.length > 0
            ? and(messageCursorCondition, notInArray(messagesTable.id, knownMessageIds))
            : messageCursorCondition)
          .orderBy(asc(messagesTable.sentAt), asc(messagesTable.id))
          .limit(100);

        for (const message of messages) {
          if (!rememberMessage(message.id)) continue;
          const sentAt = message.sentAt.getTime();
          const currentCursorAt = Date.parse(cursor.messageAt);
          if (sentAt > currentCursorAt || (sentAt === currentCursorAt && message.id > cursor.messageId)) {
            cursor.messageAt = message.sentAt.toISOString();
            cursor.messageId = message.id;
          }
          send({
            type: "message.created",
            conversationId: message.conversationId,
            messageId: message.id,
            senderAddress: message.senderAddress,
            isRequest: message.conversationType === "direct" && message.directStatus === "pending",
          });
        }

        const myConversations = db
          .select({ conversationId: conversationMembersTable.conversationId })
          .from(conversationMembersTable)
          .where(eq(conversationMembersTable.walletAddress, walletAddress));
        const readReceipts = await db
          .select({
            conversationId: conversationMembersTable.conversationId,
            lastReadAt: conversationMembersTable.lastReadAt,
          })
          .from(conversationMembersTable)
          .where(
            and(
              inArray(conversationMembersTable.conversationId, myConversations),
              ne(conversationMembersTable.walletAddress, walletAddress),
              or(
                gt(conversationMembersTable.lastReadAt, new Date(cursor.readAt)),
                and(
                  eq(conversationMembersTable.lastReadAt, new Date(cursor.readAt)),
                  gt(conversationMembersTable.conversationId, cursor.readConversationId),
                ),
              ),
            ),
          )
          .orderBy(asc(conversationMembersTable.lastReadAt), asc(conversationMembersTable.conversationId))
          .limit(100);

        for (const receipt of readReceipts) {
          if (!receipt.lastReadAt) continue;
          const readAt = receipt.lastReadAt.getTime();
          const currentReadAt = Date.parse(cursor.readAt);
          if (
            readAt > currentReadAt
            || (readAt === currentReadAt && receipt.conversationId > cursor.readConversationId)
          ) {
            cursor.readAt = receipt.lastReadAt.toISOString();
            cursor.readConversationId = receipt.conversationId;
          }
          send({ type: "message.read", conversationId: receipt.conversationId });
        }
      } catch (error) {
        req.log.error({ err: error }, "Could not poll persisted message events");
        if (!res.writableEnded && !res.destroyed) res.write(": retrying\n\n");
      } finally {
        pollInFlight = false;
      }
    };

    const polling = setInterval(() => void poll(), 1_500);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(": keepalive\n\n");
    }, 20_000);
    const maximumLifetime = setTimeout(() => res.end(), 45_000);
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(polling);
      clearInterval(heartbeat);
      clearTimeout(maximumLifetime);
    };
    res.on("close", cleanup);
    res.write(`id: ${encodeEventCursor(cursor)}\ndata: ${JSON.stringify({ type: "ready" })}\n\n`);
    void poll();
    return;
  }

  const unsubscribe = subscribeToWalletMessages(walletAddress, (event) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": keepalive\n\n");
  }, 20_000);
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  res.on("close", cleanup);
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
});

router.get("/wallet/keys/:walletAddress", async (req, res): Promise<void> => {
  const sessionWallet = requireAuth(req, res);
  if (!sessionWallet) return;
  const parsedParams = GetWalletEncryptionKeyParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Enter a valid XRPL wallet address." });
    return;
  }
  const walletAddress = parsedParams.data.walletAddress;
  const keys = await db
    .select({ walletAddress: walletKeysTable.walletAddress, publicKey: walletKeysTable.publicKey })
    .from(walletKeysTable)
    .where(eq(walletKeysTable.walletAddress, walletAddress))
    .limit(1);
  if (!keys[0]) {
    res.status(404).json({ error: "This wallet has not registered an encryption key yet." });
    return;
  }
  res.json(keys[0]);
});

router.put("/wallet/keys", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsedBody = RegisterWalletEncryptionKeyBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "A valid public encryption key is required." });
    return;
  }
  const publicKey = parsedBody.data.publicKey;
  if (!isPublicEncryptionKey(publicKey)) {
    res.status(400).json({ error: "Only public P-256 encryption keys are accepted." });
    return;
  }
  const existing = await db.select().from(walletKeysTable).where(eq(walletKeysTable.walletAddress, walletAddress)).limit(1);
  if (existing[0]) {
    if (existing[0].publicKey !== publicKey) {
      res.status(409).json({ error: "An encryption key is already registered for this wallet. Restore this device’s key before continuing; replacing it would hide old messages." });
      return;
    }
    res.json({ walletAddress, publicKey });
    return;
  }
  await db.insert(walletKeysTable).values({ walletAddress, publicKey });
  res.status(201).json({ walletAddress, publicKey });
});

router.post("/wallet/keys/reset", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsedBody = ResetWalletEncryptionKeyBody.safeParse(req.body);
  if (!parsedBody.success || !isPublicEncryptionKey(parsedBody.data.publicKey)) {
    res.status(400).json({ error: "A valid public P-256 encryption key is required." });
    return;
  }

  const resetAt = new Date();
  try {
    await db.transaction(async (transaction) => {
      await transaction
        .insert(walletKeysTable)
        .values({ walletAddress, publicKey: parsedBody.data.publicKey })
        .onConflictDoUpdate({
          target: walletKeysTable.walletAddress,
          set: { publicKey: parsedBody.data.publicKey, createdAt: resetAt },
        });
      await transaction
        .update(conversationMembersTable)
        .set({ historyStartsAt: resetAt, lastReadAt: resetAt })
        .where(eq(conversationMembersTable.walletAddress, walletAddress));
      await transaction
        .delete(messageHistorySharesTable)
        .where(eq(messageHistorySharesTable.recipientAddress, walletAddress));
    });
    res.json({ resetAt: resetAt.toISOString() });
  } catch (error) {
    req.log.error({ error }, "Wallet encryption reset failed");
    res.status(500).json({ error: "The encryption key and chat history could not be reset." });
  }
});

router.get("/conversations/:conversationId/keys", async (req, res): Promise<void> => {
  const walletAddress = requireAuth(req, res);
  if (!walletAddress) return;
  const parsedParams = GetConversationEncryptionKeysParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid conversation." });
    return;
  }
  const conversationId = parsedParams.data.conversationId;
  const membership = await db
    .select({ walletAddress: conversationMembersTable.walletAddress })
    .from(conversationMembersTable)
    .where(eq(conversationMembersTable.conversationId, conversationId));
  if (!membership.some((member) => member.walletAddress === walletAddress)) {
    res.status(403).json({ error: "You are not a member of this conversation." });
    return;
  }
  const keys = await db
    .select({
      walletAddress: conversationMembersTable.walletAddress,
      publicKey: walletKeysTable.publicKey,
    })
    .from(conversationMembersTable)
    .leftJoin(walletKeysTable, eq(conversationMembersTable.walletAddress, walletKeysTable.walletAddress))
    .where(eq(conversationMembersTable.conversationId, conversationId));
  res.json(keys);
});

router.get("/conversations", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const { walletAddress } = ListConversationsQueryParams.parse(req.query);
    requireAddress(walletAddress);
    if (!requireMatchingWallet(sessionWallet, walletAddress, res)) return;
    const memberships = await db
      .select({
        conversationId: conversationMembersTable.conversationId,
        historyStartsAt: conversationMembersTable.historyStartsAt,
      })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.walletAddress, walletAddress));
    if (memberships.length === 0) {
      res.json([]);
      return;
    }
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(inArray(conversationsTable.id, memberships.map((row) => row.conversationId)))
      .orderBy(desc(conversationsTable.lastMessageAt), desc(conversationsTable.createdAt));
    const participantRows = await db
      .select({
        conversationId: conversationMembersTable.conversationId,
        walletAddress: conversationMembersTable.walletAddress,
      })
      .from(conversationMembersTable)
      .where(inArray(conversationMembersTable.conversationId, memberships.map((row) => row.conversationId)));
    const otherWalletByConversation = new Map<string, string>();
    for (const participant of participantRows) {
      if (participant.walletAddress !== walletAddress) {
        otherWalletByConversation.set(participant.conversationId, participant.walletAddress);
      }
    }
    const blockedRows = await db
      .select({
        walletAddress: blockedWalletsTable.walletAddress,
        blockedWalletAddress: blockedWalletsTable.blockedWalletAddress,
      })
      .from(blockedWalletsTable)
      .where(or(
        eq(blockedWalletsTable.walletAddress, walletAddress),
        eq(blockedWalletsTable.blockedWalletAddress, walletAddress),
      ));
    const blockedCounterparts = new Set(blockedRows.map((row) => (
      row.walletAddress === walletAddress ? row.blockedWalletAddress : row.walletAddress
    )));
    const unreadRows = await db
      .select({
        conversationId: messagesTable.conversationId,
        unreadCount: sql<number>`count(distinct ${messagesTable.id})::int`,
      })
      .from(messagesTable)
      .innerJoin(
        conversationMembersTable,
        eq(messagesTable.conversationId, conversationMembersTable.conversationId),
      )
      .where(and(
        eq(conversationMembersTable.walletAddress, walletAddress),
        ne(messagesTable.senderAddress, walletAddress),
        or(
          isNull(conversationMembersTable.historyStartsAt),
          gt(messagesTable.sentAt, conversationMembersTable.historyStartsAt),
        ),
        or(
          isNull(conversationMembersTable.lastReadAt),
          gt(messagesTable.sentAt, conversationMembersTable.lastReadAt),
        ),
      ))
      .groupBy(messagesTable.conversationId);
    const unreadCounts = new Map(unreadRows.map((row) => [row.conversationId, row.unreadCount]));
    const historyStartsAt = new Map(memberships.map((member) => [member.conversationId, member.historyStartsAt]));
    res.json(rows
      .filter((row) => {
        const historyStart = historyStartsAt.get(row.id);
        if (
          row.type === "direct"
          && historyStart
          && (!row.lastMessageAt || row.lastMessageAt <= historyStart)
        ) return false;
        if (row.directStatus === "declined") return false;
        const otherWalletAddress = otherWalletByConversation.get(row.id);
        return !(row.type === "direct" && row.directStatus === "pending"
          && otherWalletAddress && blockedCounterparts.has(otherWalletAddress));
      })
      .map((row) => {
        const otherWalletAddress = otherWalletByConversation.get(row.id) ?? null;
        const historyStart = historyStartsAt.get(row.id);
        const historyCleared = Boolean(historyStart && row.lastMessageAt && row.lastMessageAt <= historyStart);
        return {
          ...serializeConversation(
            row,
            otherWalletAddress,
            otherWalletAddress ? blockedCounterparts.has(otherWalletAddress) : false,
          ),
          ...(historyCleared ? { lastMessage: null, lastMessageAt: null } : {}),
          unreadCount: unreadCounts.get(row.id) ?? 0,
        };
      }));
  } catch {
    res.status(400).json({ error: "Invalid wallet address." });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const input = CreateDirectConversationBody.parse(req.body);
    requireAddress(input.walletAddress);
    requireAddress(input.fromWalletAddress);
    if (!requireMatchingWallet(sessionWallet, input.fromWalletAddress, res)) return;
    if (input.walletAddress === input.fromWalletAddress) {
      res.status(400).json({ error: "Choose a different wallet address." });
      return;
    }

    const requestedParticipants = new Set([input.walletAddress, input.fromWalletAddress]);
    const outcome = await db.transaction(async (transaction) => {
      const pairKey = directPairLockKey(input.walletAddress, input.fromWalletAddress);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);

      const pairBlock = await transaction
        .select({ walletAddress: blockedWalletsTable.walletAddress })
        .from(blockedWalletsTable)
        .where(or(
          and(
            eq(blockedWalletsTable.walletAddress, input.walletAddress),
            eq(blockedWalletsTable.blockedWalletAddress, input.fromWalletAddress),
          ),
          and(
            eq(blockedWalletsTable.walletAddress, input.fromWalletAddress),
            eq(blockedWalletsTable.blockedWalletAddress, input.walletAddress),
          ),
        ))
        .limit(1);
      if (pairBlock.length > 0) return { kind: "blocked" as const };

      const sharedMemberships = await transaction
        .select({
          conversationId: conversationMembersTable.conversationId,
          walletAddress: conversationMembersTable.walletAddress,
        })
        .from(conversationMembersTable)
        .where(inArray(conversationMembersTable.walletAddress, [...requestedParticipants]));
      const sharedWalletsByConversation = new Map<string, Set<string>>();
      for (const membership of sharedMemberships) {
        const wallets = sharedWalletsByConversation.get(membership.conversationId) ?? new Set<string>();
        wallets.add(membership.walletAddress);
        sharedWalletsByConversation.set(membership.conversationId, wallets);
      }
      const sharedConversationIds = [...sharedWalletsByConversation.entries()]
        .filter(([, wallets]) => wallets.size === requestedParticipants.size)
        .map(([conversationId]) => conversationId);
      const directCandidates = sharedConversationIds.length > 0
        ? await transaction
          .select()
          .from(conversationsTable)
          .where(and(
            eq(conversationsTable.type, "direct"),
            inArray(conversationsTable.id, sharedConversationIds),
          ))
          .orderBy(desc(conversationsTable.createdAt))
        : [];
      const candidateMemberships = directCandidates.length > 0
        ? await transaction
          .select({
            conversationId: conversationMembersTable.conversationId,
            walletAddress: conversationMembersTable.walletAddress,
          })
          .from(conversationMembersTable)
          .where(inArray(
            conversationMembersTable.conversationId,
            directCandidates.map((conversation) => conversation.id),
          ))
        : [];
      const membersByConversation = new Map<string, string[]>();
      for (const membership of candidateMemberships) {
        const wallets = membersByConversation.get(membership.conversationId) ?? [];
        wallets.push(membership.walletAddress);
        membersByConversation.set(membership.conversationId, wallets);
      }
      const exactDirectCandidates = directCandidates.filter((conversation) => {
        const wallets = membersByConversation.get(conversation.id) ?? [];
        const uniqueWallets = new Set(wallets);
        return wallets.length === 2
          && uniqueWallets.size === 2
          && [...requestedParticipants].every((wallet) => uniqueWallets.has(wallet));
      });
      const activeDirect = exactDirectCandidates.find((conversation) => conversation.directStatus !== "declined");
      if (activeDirect) return { kind: "conversation" as const, conversation: activeDirect, created: false };

      const lastDeclined = exactDirectCandidates[0];
      if (lastDeclined?.requesterAddress === sessionWallet) {
        return { kind: "declined" as const };
      }

      const conversation = {
        id: `conversation-${randomUUID()}`,
        type: "direct",
        title: input.walletAddress,
        participantLabel: input.walletAddress,
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
        encrypted: true,
        memberCount: 2,
        directStatus: "pending",
        requesterAddress: sessionWallet,
        createdAt: new Date(),
      };
      await transaction.insert(conversationsTable).values(conversation);
      await transaction.insert(conversationMembersTable).values([
        { conversationId: conversation.id, walletAddress: input.walletAddress },
        { conversationId: conversation.id, walletAddress: input.fromWalletAddress },
      ]);
      return { kind: "conversation" as const, conversation, created: true };
    });

    if (outcome.kind === "blocked") {
      res.status(403).json({ error: "Private messaging is unavailable for this wallet." });
      return;
    }
    if (outcome.kind === "declined") {
      res.status(403).json({ error: "Private messaging is unavailable for this wallet." });
      return;
    }
    if (outcome.created) {
      await publishConversationUpdated(
        [input.walletAddress, input.fromWalletAddress],
        { conversationId: outcome.conversation.id },
      );
    }
    res.status(201).json(serializeConversation(outcome.conversation, input.walletAddress));
  } catch {
    res.status(400).json({ error: "Enter two valid XRPL wallet addresses." });
  }
});

router.post("/conversations/:conversationId/request/accept", async (req, res): Promise<void> => {
  const sessionWallet = requireAuth(req, res);
  if (!sessionWallet) return;
  const parsed = AcceptConversationRequestParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid conversation." });
    return;
  }
  const conversationId = parsed.data.conversationId;
  const [initial] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  if (!initial || initial.type !== "direct") {
    res.status(404).json({ error: "Private-message request not found." });
    return;
  }
  const initialMembers = await db
    .select({ walletAddress: conversationMembersTable.walletAddress })
    .from(conversationMembersTable)
    .where(eq(conversationMembersTable.conversationId, conversationId));
  const otherWalletAddress = initialMembers.find((member) => member.walletAddress !== sessionWallet)?.walletAddress;
  if (initialMembers.length !== 2 || !initialMembers.some((member) => member.walletAddress === sessionWallet) || !otherWalletAddress) {
    res.status(403).json({ error: "You cannot accept this request." });
    return;
  }
  if (initial.requesterAddress === sessionWallet) {
    res.status(403).json({ error: "Only the recipient can accept this request." });
    return;
  }

  try {
    const outcome = await db.transaction(async (transaction) => {
      const pairKey = directPairLockKey(sessionWallet, otherWalletAddress);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);
      const [current] = await transaction
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.id, conversationId))
        .limit(1);
      if (!current || current.type !== "direct") return { kind: "not-found" as const };
      const blocked = await transaction
        .select({ walletAddress: blockedWalletsTable.walletAddress })
        .from(blockedWalletsTable)
        .where(or(
          and(
            eq(blockedWalletsTable.walletAddress, sessionWallet),
            eq(blockedWalletsTable.blockedWalletAddress, otherWalletAddress),
          ),
          and(
            eq(blockedWalletsTable.walletAddress, otherWalletAddress),
            eq(blockedWalletsTable.blockedWalletAddress, sessionWallet),
          ),
        ))
        .limit(1);
      if (blocked.length > 0) return { kind: "blocked" as const };
      if (current.directStatus === "accepted") return { kind: "accepted" as const, conversation: current };
      if (current.directStatus !== "pending" || current.requesterAddress === sessionWallet) {
        return { kind: "conflict" as const };
      }
      const [updated] = await transaction
        .update(conversationsTable)
        .set({ directStatus: "accepted" })
        .where(and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.directStatus, "pending"),
        ))
        .returning();
      return updated
        ? { kind: "accepted" as const, conversation: updated }
        : { kind: "conflict" as const };
    });
    if (outcome.kind === "not-found") {
      res.status(404).json({ error: "Private-message request not found." });
      return;
    }
    if (outcome.kind === "blocked") {
      res.status(403).json({ error: "Private messaging is unavailable for this wallet." });
      return;
    }
    if (outcome.kind === "conflict") {
      res.status(409).json({ error: "This request is no longer pending." });
      return;
    }
    await publishConversationUpdated(
      [sessionWallet, otherWalletAddress],
      { conversationId },
    );
    res.json(serializeConversation(outcome.conversation, otherWalletAddress));
  } catch {
    res.status(500).json({ error: "This request could not be accepted right now." });
  }
});

router.post("/conversations/:conversationId/request/decline", async (req, res): Promise<void> => {
  const sessionWallet = requireAuth(req, res);
  if (!sessionWallet) return;
  const parsed = DeclineConversationRequestParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid conversation." });
    return;
  }
  const conversationId = parsed.data.conversationId;
  const [initial] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  if (!initial || initial.type !== "direct") {
    res.status(404).json({ error: "Private-message request not found." });
    return;
  }
  const initialMembers = await db
    .select({ walletAddress: conversationMembersTable.walletAddress })
    .from(conversationMembersTable)
    .where(eq(conversationMembersTable.conversationId, conversationId));
  const otherWalletAddress = initialMembers.find((member) => member.walletAddress !== sessionWallet)?.walletAddress;
  if (initialMembers.length !== 2 || !initialMembers.some((member) => member.walletAddress === sessionWallet) || !otherWalletAddress) {
    res.status(403).json({ error: "You cannot decline this request." });
    return;
  }
  if (initial.requesterAddress === sessionWallet) {
    res.status(403).json({ error: "Only the recipient can decline this request." });
    return;
  }

  try {
    const outcome = await db.transaction(async (transaction) => {
      const pairKey = directPairLockKey(sessionWallet, otherWalletAddress);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);
      const [current] = await transaction
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.id, conversationId))
        .limit(1);
      if (!current || current.type !== "direct") return { kind: "not-found" as const };
      if (current.directStatus !== "pending" || current.requesterAddress === sessionWallet) {
        return { kind: "conflict" as const };
      }
      const [updated] = await transaction
        .update(conversationsTable)
        .set({ directStatus: "declined" })
        .where(and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.directStatus, "pending"),
        ))
        .returning();
      return updated
        ? { kind: "declined" as const, conversation: updated }
        : { kind: "conflict" as const };
    });
    if (outcome.kind === "not-found") {
      res.status(404).json({ error: "Private-message request not found." });
      return;
    }
    if (outcome.kind === "conflict") {
      res.status(409).json({ error: "This request is no longer pending." });
      return;
    }
    await publishConversationUpdated(
      [sessionWallet, otherWalletAddress],
      { conversationId },
    );
    res.json(serializeConversation(outcome.conversation, otherWalletAddress));
  } catch {
    res.status(500).json({ error: "This request could not be declined right now." });
  }
});

router.get("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const { conversationId } = ListConversationMessagesParams.parse(req.params);
    const { walletAddress } = ListConversationMessagesQueryParams.parse(req.query);
    requireAddress(walletAddress);
    if (!requireMatchingWallet(sessionWallet, walletAddress, res)) return;
    const memberships = await db
      .select({
        walletAddress: conversationMembersTable.walletAddress,
        lastReadAt: conversationMembersTable.lastReadAt,
        historyStartsAt: conversationMembersTable.historyStartsAt,
      })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, conversationId));
    const currentMembership = memberships.find((member) => member.walletAddress === sessionWallet);
    if (!currentMembership) {
      res.status(403).json({ error: "You are not a member of this conversation." });
      return;
    }
    const [conversation] = await db
      .select({ type: conversationsTable.type, directStatus: conversationsTable.directStatus })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);
    if (conversation?.type === "direct" && conversation.directStatus === "declined") {
      res.status(403).json({ error: "This private-message request is no longer available." });
      return;
    }
    const messageFilter = currentMembership.historyStartsAt
      ? and(
        eq(messagesTable.conversationId, conversationId),
        gt(messagesTable.sentAt, currentMembership.historyStartsAt),
      )
      : eq(messagesTable.conversationId, conversationId);
    const rows = await db
      .select()
      .from(messagesTable)
      .where(messageFilter)
      .orderBy(asc(messagesTable.sentAt));
    res.json(rows.map((row) => {
      const recipients = memberships.filter((member) => member.walletAddress !== row.senderAddress);
      const isRead = recipients.length > 0
        && recipients.every((member) => member.lastReadAt !== null && member.lastReadAt >= row.sentAt);
      return { ...row, isMine: row.senderAddress === walletAddress, isRead };
    }));
  } catch {
    res.status(400).json({ error: "Unable to load this conversation." });
  }
});

router.get("/conversations/:conversationId/history-share-work", async (req, res): Promise<void> => {
  const sessionWallet = requireAuth(req, res);
  if (!sessionWallet) return;
  const parsed = ListConversationHistoryShareWorkParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid conversation." });
    return;
  }
  const conversationId = parsed.data.conversationId;
  const conversation = await db
    .select({ type: conversationsTable.type })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  if (conversation[0]?.type !== "group") {
    res.status(404).json({ error: "Group conversation not found." });
    return;
  }
  const memberships = await db
    .select({
      walletAddress: conversationMembersTable.walletAddress,
      joinedAt: conversationMembersTable.joinedAt,
      historyStartsAt: conversationMembersTable.historyStartsAt,
    })
    .from(conversationMembersTable)
    .where(eq(conversationMembersTable.conversationId, conversationId));
  const sharerMembership = memberships.find((member) => member.walletAddress === sessionWallet);
  if (!sharerMembership) {
    res.status(403).json({ error: "You are not a member of this group." });
    return;
  }

  const [messages, existingShares] = await Promise.all([
    db.select({
      id: messagesTable.id,
      senderAddress: messagesTable.senderAddress,
      body: messagesTable.body,
      sentAt: messagesTable.sentAt,
    })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(asc(messagesTable.sentAt)),
    db.select({
      messageId: messageHistorySharesTable.messageId,
      recipientAddress: messageHistorySharesTable.recipientAddress,
    })
      .from(messageHistorySharesTable)
      .where(eq(messageHistorySharesTable.conversationId, conversationId)),
  ]);
  const keys = memberships.length > 0
    ? await db.select({
      walletAddress: walletKeysTable.walletAddress,
      publicKey: walletKeysTable.publicKey,
    })
      .from(walletKeysTable)
      .where(inArray(walletKeysTable.walletAddress, memberships.map((member) => member.walletAddress)))
    : [];
  const publicKeys = new Map(keys.map((key) => [key.walletAddress, key.publicKey]));
  const sharedPairs = new Set(existingShares.map((share) => `${share.messageId}:${share.recipientAddress}`));
  const work: Array<{
    messageId: string;
    senderAddress: string;
    body: string;
    sentAt: Date;
    recipientAddress: string;
    recipientPublicKey: string;
  }> = [];

  for (const message of messages) {
    if (
      sharerMembership.joinedAt > message.sentAt
      || (sharerMembership.historyStartsAt && sharerMembership.historyStartsAt >= message.sentAt)
      || !envelopeIncludesRecipient(message.body, sessionWallet)
    ) continue;
    for (const recipient of memberships) {
      const publicKey = publicKeys.get(recipient.walletAddress);
      if (
        recipient.walletAddress === sessionWallet
        || recipient.joinedAt <= message.sentAt
        || (recipient.historyStartsAt && recipient.historyStartsAt >= message.sentAt)
        || !publicKey
        || sharedPairs.has(`${message.id}:${recipient.walletAddress}`)
      ) continue;
      work.push({
        messageId: message.id,
        senderAddress: message.senderAddress,
        body: message.body,
        sentAt: message.sentAt,
        recipientAddress: recipient.walletAddress,
        recipientPublicKey: publicKey,
      });
      if (work.length >= 20) {
        res.json(work);
        return;
      }
    }
  }
  res.json(work);
});

router.get("/conversations/:conversationId/history-shares", async (req, res): Promise<void> => {
  const sessionWallet = requireAuth(req, res);
  if (!sessionWallet) return;
  const parsed = ListConversationHistorySharesParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid conversation." });
    return;
  }
  const conversationId = parsed.data.conversationId;
  const membership = await db
    .select({
      walletAddress: conversationMembersTable.walletAddress,
      historyStartsAt: conversationMembersTable.historyStartsAt,
    })
    .from(conversationMembersTable)
    .where(and(
      eq(conversationMembersTable.conversationId, conversationId),
      eq(conversationMembersTable.walletAddress, sessionWallet),
    ))
    .limit(1);
  if (!membership[0]) {
    res.status(403).json({ error: "You are not a member of this conversation." });
    return;
  }
  const shareFilter = membership[0].historyStartsAt
    ? and(
      eq(messageHistorySharesTable.conversationId, conversationId),
      eq(messageHistorySharesTable.recipientAddress, sessionWallet),
      gt(messagesTable.sentAt, membership[0].historyStartsAt),
    )
    : and(
      eq(messageHistorySharesTable.conversationId, conversationId),
      eq(messageHistorySharesTable.recipientAddress, sessionWallet),
    );
  const shares = await db.select({
    messageId: messageHistorySharesTable.messageId,
    sharedByAddress: messageHistorySharesTable.sharedByAddress,
    body: messageHistorySharesTable.body,
    createdAt: messageHistorySharesTable.createdAt,
  })
    .from(messageHistorySharesTable)
    .innerJoin(messagesTable, eq(messagesTable.id, messageHistorySharesTable.messageId))
    .where(shareFilter);
  res.json(shares);
});

router.post("/conversations/:conversationId/history-shares", async (req, res): Promise<void> => {
  const sessionWallet = requireAuth(req, res);
  if (!sessionWallet) return;
  const parsedParams = CreateConversationHistoryShareParams.safeParse(req.params);
  const parsedBody = CreateConversationHistoryShareBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid encrypted history share." });
    return;
  }
  const { conversationId } = parsedParams.data;
  const { messageId, recipientAddress, body } = parsedBody.data;
  if (!isWalletAddress(recipientAddress) || !hasValidRecipientEnvelope(body, [recipientAddress])) {
    res.status(400).json({ error: "History shares must be encrypted only for the named recipient." });
    return;
  }

  const [conversation, message, memberships, recipientKey] = await Promise.all([
    db.select({ type: conversationsTable.type })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1),
    db.select({
      id: messagesTable.id,
      body: messagesTable.body,
      sentAt: messagesTable.sentAt,
      encrypted: messagesTable.encrypted,
    })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.id, messageId),
        eq(messagesTable.conversationId, conversationId),
      ))
      .limit(1),
    db.select({
      walletAddress: conversationMembersTable.walletAddress,
      joinedAt: conversationMembersTable.joinedAt,
      historyStartsAt: conversationMembersTable.historyStartsAt,
    })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, conversationId)),
    db.select({ walletAddress: walletKeysTable.walletAddress })
      .from(walletKeysTable)
      .where(eq(walletKeysTable.walletAddress, recipientAddress))
      .limit(1),
  ]);
  if (conversation[0]?.type !== "group" || !message[0] || !message[0].encrypted) {
    res.status(404).json({ error: "Encrypted group message not found." });
    return;
  }
  const sharer = memberships.find((member) => member.walletAddress === sessionWallet);
  const recipient = memberships.find((member) => member.walletAddress === recipientAddress);
  if (!sharer || !recipient) {
    res.status(403).json({ error: "Both wallets must currently belong to the group." });
    return;
  }
  if (
    sharer.joinedAt > message[0].sentAt
    || recipient.joinedAt <= message[0].sentAt
    || (sharer.historyStartsAt && sharer.historyStartsAt >= message[0].sentAt)
    || (recipient.historyStartsAt && recipient.historyStartsAt >= message[0].sentAt)
    || !envelopeIncludesRecipient(message[0].body, sessionWallet)
    || recipientKey.length === 0
  ) {
    res.status(403).json({ error: "Only an eligible existing member can share this message with a newer member." });
    return;
  }

  await db.insert(messageHistorySharesTable).values({
    conversationId,
    messageId,
    recipientAddress,
    sharedByAddress: sessionWallet,
    body,
  }).onConflictDoNothing();
  const saved = await db.select({
    messageId: messageHistorySharesTable.messageId,
    sharedByAddress: messageHistorySharesTable.sharedByAddress,
    body: messageHistorySharesTable.body,
    createdAt: messageHistorySharesTable.createdAt,
  })
    .from(messageHistorySharesTable)
    .where(and(
      eq(messageHistorySharesTable.conversationId, conversationId),
      eq(messageHistorySharesTable.messageId, messageId),
      eq(messageHistorySharesTable.recipientAddress, recipientAddress),
    ))
    .limit(1);
  if (!saved[0]) {
    res.status(500).json({ error: "Encrypted history share could not be saved." });
    return;
  }
  res.status(201).json(saved[0]);
});

router.post("/conversations/:conversationId/read", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const { conversationId } = MarkConversationReadParams.parse(req.params);
    const input = MarkConversationReadBody.parse(req.body);
    const membership = await db
      .select({
        walletAddress: conversationMembersTable.walletAddress,
        historyStartsAt: conversationMembersTable.historyStartsAt,
      })
      .from(conversationMembersTable)
      .where(and(
        eq(conversationMembersTable.conversationId, conversationId),
        eq(conversationMembersTable.walletAddress, sessionWallet),
      ))
      .limit(1);
    if (!membership[0]) {
      res.status(403).json({ error: "You are not a member of this conversation." });
      return;
    }
    const [conversation] = await db
      .select({ type: conversationsTable.type, directStatus: conversationsTable.directStatus })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);
    if (conversation?.type === "direct" && conversation.directStatus === "declined") {
      res.status(403).json({ error: "This private-message request is no longer available." });
      return;
    }
    const readMessageFilter = membership[0].historyStartsAt
      ? and(
        eq(messagesTable.id, input.messageId),
        eq(messagesTable.conversationId, conversationId),
        gt(messagesTable.sentAt, membership[0].historyStartsAt),
      )
      : and(
        eq(messagesTable.id, input.messageId),
        eq(messagesTable.conversationId, conversationId),
      );
    const message = await db
      .select({ sentAt: messagesTable.sentAt })
      .from(messagesTable)
      .where(readMessageFilter)
      .limit(1);
    if (!message[0]) {
      res.status(404).json({ error: "Message not found in this conversation." });
      return;
    }

    const updated = await db
      .update(conversationMembersTable)
      .set({ lastReadAt: message[0].sentAt })
      .where(and(
        eq(conversationMembersTable.conversationId, conversationId),
        eq(conversationMembersTable.walletAddress, sessionWallet),
        or(
          isNull(conversationMembersTable.lastReadAt),
          lt(conversationMembersTable.lastReadAt, message[0].sentAt),
        ),
      ))
      .returning({ lastReadAt: conversationMembersTable.lastReadAt });
    const persistedReadAt = updated[0]?.lastReadAt ?? (await db
      .select({ lastReadAt: conversationMembersTable.lastReadAt })
      .from(conversationMembersTable)
      .where(and(
        eq(conversationMembersTable.conversationId, conversationId),
        eq(conversationMembersTable.walletAddress, sessionWallet),
      ))
      .limit(1))[0]?.lastReadAt ?? message[0].sentAt;
    const otherMembers = await db
      .select({ walletAddress: conversationMembersTable.walletAddress })
      .from(conversationMembersTable)
      .where(and(
        eq(conversationMembersTable.conversationId, conversationId),
        ne(conversationMembersTable.walletAddress, sessionWallet),
      ));
    await publishMessageRead(
      otherMembers.map((member) => member.walletAddress),
      { conversationId },
    );
    res.json({ conversationId, lastReadAt: persistedReadAt });
  } catch {
    res.status(400).json({ error: "Unable to mark these messages as read." });
  }
});

router.post("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const { conversationId } = SendMessageParams.parse(req.params);
    const input = SendMessageBody.parse(req.body);
    requireAddress(input.senderAddress);
    if (!requireMatchingWallet(sessionWallet, input.senderAddress, res)) return;
    if (!input.body.trim()) {
      res.status(400).json({ error: "Message cannot be empty." });
      return;
    }
    if (!input.body.startsWith("e2ee:v1:")) {
      res.status(400).json({ error: "Messages must be encrypted on your device before sending." });
      return;
    }

    const [conversation] = await db
      .select({
        type: conversationsTable.type,
        directStatus: conversationsTable.directStatus,
        requesterAddress: conversationsTable.requesterAddress,
      })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const memberships = await db
      .select({ walletAddress: conversationMembersTable.walletAddress })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, conversationId));
    if (!memberships.some((member) => member.walletAddress === input.senderAddress)) {
      res.status(403).json({ error: "You are not a member of this conversation." });
      return;
    }
    const recipientWallets = conversation.type === "group"
      ? (await db
        .select({ walletAddress: conversationMembersTable.walletAddress })
        .from(conversationMembersTable)
        .innerJoin(walletKeysTable, eq(walletKeysTable.walletAddress, conversationMembersTable.walletAddress))
        .where(eq(conversationMembersTable.conversationId, conversationId)))
        .map((member) => member.walletAddress)
      : memberships.map((member) => member.walletAddress);
    if (!recipientWallets.includes(input.senderAddress)) {
      res.status(403).json({ error: "Register this device’s encryption key before sending to the room." });
      return;
    }
    if (!hasValidRecipientEnvelope(input.body, recipientWallets)) {
      res.status(400).json({
        error: conversation.type === "group"
          ? "Encrypted message recipients must match the group members with registered encryption keys."
          : "Encrypted message recipients must match the conversation members.",
      });
      return;
    }

    const message = {
      id: input.messageId,
      conversationId,
      senderAddress: input.senderAddress,
      body: input.body,
      sentAt: new Date(),
      encrypted: true,
    };
    const outcome = await db.transaction(async (transaction) => {
      let isRequest = false;
      if (conversation.type === "direct") {
        const pairMembers = [...new Set(memberships.map((member) => member.walletAddress))];
        if (pairMembers.length !== 2) {
          return { kind: "unavailable" as const };
        }
        const pairKey = directPairLockKey(pairMembers[0], pairMembers[1]);
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`);

        const blocked = await transaction
          .select({ walletAddress: blockedWalletsTable.walletAddress })
          .from(blockedWalletsTable)
          .where(or(
            and(
              eq(blockedWalletsTable.walletAddress, pairMembers[0]),
              eq(blockedWalletsTable.blockedWalletAddress, pairMembers[1]),
            ),
            and(
              eq(blockedWalletsTable.walletAddress, pairMembers[1]),
              eq(blockedWalletsTable.blockedWalletAddress, pairMembers[0]),
            ),
          ))
          .limit(1);
        if (blocked.length > 0) return { kind: "unavailable" as const };

        const [current] = await transaction
          .select({
            directStatus: conversationsTable.directStatus,
            requesterAddress: conversationsTable.requesterAddress,
          })
          .from(conversationsTable)
          .where(eq(conversationsTable.id, conversationId))
          .limit(1);
        if (!current || current.directStatus === "declined") {
          return { kind: "unavailable" as const };
        }
        isRequest = current.directStatus === "pending";
        if (isRequest && current.requesterAddress !== input.senderAddress) {
          return { kind: "not-accepted" as const };
        }

        const existingById = await transaction
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.id, input.messageId))
          .limit(1);
        if (existingById[0]) {
          const previous = existingById[0];
          if (
            previous.conversationId !== conversationId
            || previous.senderAddress !== input.senderAddress
            || previous.body !== input.body
          ) {
            throw new Error("Message ID is already in use.");
          }
          return { kind: "saved" as const, message: previous, created: false, isRequest };
        }

        if (isRequest) {
          const existingRequestMessages = await transaction
            .select({ id: messagesTable.id })
            .from(messagesTable)
            .where(eq(messagesTable.conversationId, conversationId))
            .limit(1);
          if (existingRequestMessages.length > 0) return { kind: "request-already-sent" as const };
        }
      }

      const inserted = await transaction
        .insert(messagesTable)
        .values(message)
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        const existing = await transaction
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.id, input.messageId))
          .limit(1);
        const previous = existing[0];
        if (!previous
          || previous.conversationId !== conversationId
          || previous.senderAddress !== input.senderAddress
          || previous.body !== input.body) {
          throw new Error("Message ID is already in use.");
        }
        return { kind: "saved" as const, message: previous, created: false, isRequest };
      }
      await transaction
        .update(conversationsTable)
        .set({ lastMessage: "e2ee:v1:", lastMessageAt: message.sentAt })
        .where(eq(conversationsTable.id, conversationId));
      if (conversation?.type === "group") {
        await recordDailyQuestActionInTransaction(transaction, input.senderAddress, "room_message", input.messageId);
      }
      return { kind: "saved" as const, message, created: true, isRequest };
    });
    if (outcome.kind === "unavailable") {
      res.status(403).json({ error: "Private messaging is unavailable for this wallet." });
      return;
    }
    if (outcome.kind === "not-accepted") {
      res.status(403).json({ error: "Accept this private-message request before replying." });
      return;
    }
    if (outcome.kind === "request-already-sent") {
      res.status(409).json({ error: "Only one introductory message can be sent before the request is accepted." });
      return;
    }
    if (outcome.created) {
      await publishMessageCreated(
        memberships.map((member) => member.walletAddress),
        {
          conversationId,
          messageId: outcome.message.id,
          senderAddress: outcome.message.senderAddress,
          isRequest: outcome.isRequest,
        },
      );
      await sendNewMessagePush(
        memberships.map((member) => member.walletAddress),
        input.senderAddress,
        conversationId,
        outcome.message.id,
        req.get("origin")?.startsWith("https://")
          ? req.get("origin")!
          : `https://${req.get("host") ?? "localhost"}`,
      );
    }
    const readState = await db
      .select({
        walletAddress: conversationMembersTable.walletAddress,
        lastReadAt: conversationMembersTable.lastReadAt,
      })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, conversationId));
    const recipients = readState.filter((member) => member.walletAddress !== outcome.message.senderAddress);
    const isRead = recipients.length > 0
      && recipients.every((member) => member.lastReadAt !== null && member.lastReadAt >= outcome.message.sentAt);
    res.status(outcome.created ? 201 : 200).json({ ...outcome.message, isMine: true, isRead });
  } catch {
    res.status(400).json({ error: "Message could not be sent." });
  }
});

router.get("/groups", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const { walletAddress } = ListGroupsQueryParams.parse(req.query);
    requireAddress(walletAddress);
    if (!requireMatchingWallet(sessionWallet, walletAddress, res)) return;
    await ensureSeedGroups();
    const groups = await db.select().from(groupsTable);
    const memberships = await db
      .select()
      .from(groupMembersTable)
      .where(eq(groupMembersTable.walletAddress, walletAddress));
    const memberCounts = await db
      .select({
        groupId: groupMembersTable.groupId,
        memberCount: sql<number>`count(distinct ${groupMembersTable.walletAddress})::int`,
      })
      .from(groupMembersTable)
      .groupBy(groupMembersTable.groupId);
    const countsByGroup = new Map(memberCounts.map((row) => [row.groupId, row.memberCount]));
    const joined = new Set(memberships.map((member) => member.groupId));
    res.json(groups.map((group) => ({
      ...group,
      memberCount: countsByGroup.get(group.id) ?? 0,
      onlineCount: 0,
      isJoined: joined.has(group.id),
    })));
  } catch {
    res.status(400).json({ error: "Unable to load groups." });
  }
});

router.post("/groups", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    const input = CreateGroupBody.parse(req.body);
    if (!sessionWallet) return;
    requireAddress(input.creatorAddress);
    if (!requireMatchingWallet(sessionWallet, input.creatorAddress, res)) return;
    const groupId = `group-${randomUUID()}`;
    const conversationId = `conversation-${randomUUID()}`;
    const group = {
      id: groupId,
      conversationId,
      name: input.name.trim(),
      description: input.description.trim(),
      memberCount: 1,
      onlineCount: 0,
      creatorAddress: input.creatorAddress,
    };
    await db.insert(groupsTable).values(group);
    await db.insert(groupMembersTable).values({ groupId, walletAddress: input.creatorAddress });
    await db.insert(conversationsTable).values({
      id: conversationId,
      type: "group",
      title: group.name,
      participantLabel: "1 member",
      encrypted: true,
      memberCount: 1,
    });
    await db.insert(conversationMembersTable).values({
      conversationId,
      walletAddress: input.creatorAddress,
    });
    res.status(201).json({ ...group, isJoined: true });
  } catch {
    res.status(400).json({ error: "Group could not be created." });
  }
});

router.post("/groups/:groupId/join", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    const { groupId } = JoinGroupParams.parse(req.params);
    const { walletAddress } = JoinGroupBody.parse(req.body);
    if (!sessionWallet) return;
    requireAddress(walletAddress);
    if (!requireMatchingWallet(sessionWallet, walletAddress, res)) return;
    const group = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    if (!group[0]) {
      res.status(404).json({ error: "Group not found." });
      return;
    }
    const existing = await db
      .select()
      .from(groupMembersTable)
      .where(
        and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.walletAddress, walletAddress)),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(groupMembersTable).values({ groupId, walletAddress });
      await db.insert(conversationMembersTable).values({
        conversationId: group[0].conversationId,
        walletAddress,
      });
    }
    const members = await db
      .select()
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, groupId));
    await db
      .update(groupsTable)
      .set({ memberCount: members.length, onlineCount: 0 })
      .where(eq(groupsTable.id, groupId));
    await db
      .update(conversationsTable)
      .set({ memberCount: members.length, participantLabel: `${members.length} members` })
      .where(eq(conversationsTable.id, group[0].conversationId));
    res.json({ ...group[0], memberCount: members.length, onlineCount: 0, isJoined: true });
  } catch {
    res.status(400).json({ error: "Unable to join this group." });
  }
});

export default router;