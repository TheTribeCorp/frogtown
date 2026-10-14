import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CreateDirectConversationBody,
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
  ListConversationsQueryParams,
  ListGroupsQueryParams,
  RegisterWalletEncryptionKeyBody,
  SendMessageBody,
  SendMessageParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { publishMessageCreated, publishMessageRead, subscribeToWalletMessages, type WalletEvent } from "../lib/message-events";
import { recordDailyQuestActionInTransaction } from "../lib/gamification";
import { getWalletHermitTick } from "../lib/hermit-tick";
import {
  conversationMembersTable,
  conversationsTable,
  groupMembersTable,
  groupsTable,
  messagesTable,
  walletKeysTable,
} from "@workspace/db";

const router: IRouter = Router();

let groupSeedPromise: Promise<void> | undefined;
const AUTH_COOKIE = "swamp_session";
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isWalletAddress = (value: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);

type EventCursor = {
  messageAt: string;
  messageId: string;
  readAt: string;
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
      !Number.isFinite(Date.parse(parsed.readAt))
    ) {
      return null;
    }
    return {
      messageAt: parsed.messageAt,
      messageId: parsed.messageId,
      readAt: parsed.readAt,
    };
  } catch {
    return null;
  }
}

function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function serializeConversation(row: typeof conversationsTable.$inferSelect) {
  return {
    ...row,
    lastMessage: row.lastMessage ? "Encrypted message" : null,
  };
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
    const now = new Date().toISOString();
    const cursor = decodeEventCursor(req.get("Last-Event-ID")) ?? {
      messageAt: now,
      messageId: "",
      readAt: now,
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
        const messages = await db
          .select({
            id: messagesTable.id,
            conversationId: messagesTable.conversationId,
            senderAddress: messagesTable.senderAddress,
            sentAt: messagesTable.sentAt,
          })
          .from(messagesTable)
          .innerJoin(
            conversationMembersTable,
            and(
              eq(messagesTable.conversationId, conversationMembersTable.conversationId),
              eq(conversationMembersTable.walletAddress, walletAddress),
            ),
          )
          .where(
            or(
              gt(messagesTable.sentAt, messageAt),
              and(
                eq(messagesTable.sentAt, messageAt),
                gt(messagesTable.id, cursor.messageId),
              ),
            ),
          )
          .orderBy(asc(messagesTable.sentAt), asc(messagesTable.id))
          .limit(100);

        for (const message of messages) {
          cursor.messageAt = message.sentAt.toISOString();
          cursor.messageId = message.id;
          send({
            type: "message.created",
            conversationId: message.conversationId,
            messageId: message.id,
            senderAddress: message.senderAddress,
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
              gt(conversationMembersTable.lastReadAt, new Date(cursor.readAt)),
            ),
          )
          .orderBy(asc(conversationMembersTable.lastReadAt), asc(conversationMembersTable.conversationId))
          .limit(100);

        for (const receipt of readReceipts) {
          if (!receipt.lastReadAt) continue;
          cursor.readAt = receipt.lastReadAt.toISOString();
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
  try {
    const parsed = JSON.parse(publicKey) as Record<string, unknown>;
    if (parsed.kty !== "EC" || parsed.crv !== "P-256" || typeof parsed.x !== "string" || typeof parsed.y !== "string" || "d" in parsed) {
      res.status(400).json({ error: "Only public P-256 encryption keys are accepted." });
      return;
    }
  } catch {
    res.status(400).json({ error: "Encryption key must be valid JSON." });
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
      .select({ conversationId: conversationMembersTable.conversationId })
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
          isNull(conversationMembersTable.lastReadAt),
          gt(messagesTable.sentAt, conversationMembersTable.lastReadAt),
        ),
      ))
      .groupBy(messagesTable.conversationId);
    const unreadCounts = new Map(unreadRows.map((row) => [row.conversationId, row.unreadCount]));
    res.json(rows.map((row) => ({
      ...serializeConversation(row),
      unreadCount: unreadCounts.get(row.id) ?? 0,
    })));
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

    const memberships = await db
      .select()
      .from(conversationMembersTable)
      .where(
        and(
          inArray(conversationMembersTable.walletAddress, [input.walletAddress, input.fromWalletAddress]),
        ),
      );
    const existingIds = new Map<string, number>();
    for (const membership of memberships) {
      existingIds.set(
        membership.conversationId,
        (existingIds.get(membership.conversationId) ?? 0) + 1,
      );
    }
    const existingId = [...existingIds.entries()].find(([, count]) => count === 2)?.[0];
    if (existingId) {
      const existing = await db
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.id, existingId))
        .limit(1);
      if (existing[0]) {
        res.status(201).json(serializeConversation(existing[0]));
        return;
      }
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
      createdAt: new Date(),
    };
    await db.insert(conversationsTable).values(conversation);
    await db.insert(conversationMembersTable).values([
      { conversationId: conversation.id, walletAddress: input.walletAddress },
      { conversationId: conversation.id, walletAddress: input.fromWalletAddress },
    ]);
    res.status(201).json(serializeConversation(conversation));
  } catch {
    res.status(400).json({ error: "Enter two valid XRPL wallet addresses." });
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
      })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, conversationId));
    if (!memberships.some((member) => member.walletAddress === sessionWallet)) {
      res.status(403).json({ error: "You are not a member of this conversation." });
      return;
    }
    const rows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
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

router.post("/conversations/:conversationId/read", async (req, res) => {
  try {
    const sessionWallet = requireAuth(req, res);
    if (!sessionWallet) return;
    const { conversationId } = MarkConversationReadParams.parse(req.params);
    const input = MarkConversationReadBody.parse(req.body);
    const membership = await db
      .select({ walletAddress: conversationMembersTable.walletAddress })
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
    const message = await db
      .select({ sentAt: messagesTable.sentAt })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.id, input.messageId),
        eq(messagesTable.conversationId, conversationId),
      ))
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

    const memberships = await db
      .select({ walletAddress: conversationMembersTable.walletAddress })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, conversationId));
    if (!memberships.some((member) => member.walletAddress === input.senderAddress)) {
      res.status(403).json({ error: "You are not a member of this conversation." });
      return;
    }
    if (!hasValidRecipientEnvelope(input.body, memberships.map((member) => member.walletAddress))) {
      res.status(400).json({ error: "Encrypted message recipients must match the conversation members." });
      return;
    }
    const [conversation] = await db
      .select({ type: conversationsTable.type })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);

    const message = {
      id: input.messageId,
      conversationId,
      senderAddress: input.senderAddress,
      body: input.body,
      sentAt: new Date(),
      encrypted: true,
    };
    const outcome = await db.transaction(async (transaction) => {
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
          || previous.senderAddress !== input.senderAddress) {
          throw new Error("Message ID is already in use.");
        }
        return { message: previous, created: false };
      }
      await transaction
        .update(conversationsTable)
        .set({ lastMessage: "e2ee:v1:", lastMessageAt: message.sentAt })
        .where(eq(conversationsTable.id, conversationId));
      if (conversation?.type === "group") {
        await recordDailyQuestActionInTransaction(transaction, input.senderAddress, "room_message", input.messageId);
      }
      return { message, created: true };
    });
    if (outcome.created) {
      await publishMessageCreated(
        memberships.map((member) => member.walletAddress),
        {
          conversationId,
          messageId: outcome.message.id,
          senderAddress: outcome.message.senderAddress,
        },
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