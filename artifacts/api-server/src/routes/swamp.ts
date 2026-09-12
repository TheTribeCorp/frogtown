import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  CreateDirectConversationBody,
  CreateGroupBody,
  GetWalletSessionParams,
  JoinGroupBody,
  JoinGroupParams,
  ListConversationMessagesParams,
  ListConversationMessagesQueryParams,
  ListConversationsQueryParams,
  ListGroupsQueryParams,
  SendMessageBody,
  SendMessageParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  conversationMembersTable,
  conversationsTable,
  groupMembersTable,
  groupsTable,
  messagesTable,
} from "@workspace/db";
import { decryptMessage, encryptMessage } from "../lib/message-crypto";

const router: IRouter = Router();

type XamanSession = {
  xamanId: string;
  expiresAt: Date;
};

const xamanSessions = new Map<string, XamanSession>();
let groupSeedPromise: Promise<void> | undefined;

const isWalletAddress = (value: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);

function serializeConversation(row: typeof conversationsTable.$inferSelect) {
  return {
    ...row,
    lastMessage: row.lastMessage ? decryptMessage(row.lastMessage) : null,
  };
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
          memberCount: 184,
          onlineCount: 32,
          creatorAddress,
        },
        {
          id: `group-${randomUUID()}`,
          conversationId: `conversation-${randomUUID()}`,
          name: "Trencher Radio",
          description: "Market chatter for people who keep shipping.",
          memberCount: 96,
          onlineCount: 18,
          creatorAddress,
        },
      ];

      for (const group of seedGroups) {
        await db.insert(groupsTable).values(group);
        await db.insert(conversationsTable).values({
          id: group.conversationId,
          type: "group",
          title: group.name,
          participantLabel: `${group.memberCount} members`,
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

router.post("/wallet/sessions", async (_req, res) => {
  const apiKey = process.env.XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET;
  if (!apiKey || !apiSecret) {
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
    xamanSessions.set(payload.uuid, { xamanId: payload.uuid, expiresAt });
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
    const session = xamanSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Wallet session not found." });
      return;
    }
    if (session.expiresAt.getTime() < Date.now()) {
      res.json({ sessionId, status: "expired", walletAddress: null, network: "XRPL Mainnet" });
      return;
    }

    const apiKey = process.env.XAMAN_API_KEY;
    const apiSecret = process.env.XAMAN_API_SECRET;
    const response = await fetch(`https://xumm.app/api/v1/platform/payload/${session.xamanId}`, {
      headers: { "X-API-Key": apiKey ?? "", "X-API-Secret": apiSecret ?? "" },
    });
    if (!response.ok) {
      res.status(502).json({ error: "Xaman could not be reached." });
      return;
    }

    const payload = (await response.json()) as {
      meta?: { resolved?: boolean; signed?: boolean };
      response?: { account?: string };
    };
    const walletAddress = payload.response?.account ?? null;
    const connected = payload.meta?.resolved === true && payload.meta?.signed === true && walletAddress;
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

router.get("/conversations", async (req, res) => {
  try {
    const { walletAddress } = ListConversationsQueryParams.parse(req.query);
    requireAddress(walletAddress);
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
    res.json(rows.map(serializeConversation));
  } catch {
    res.status(400).json({ error: "Invalid wallet address." });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const input = CreateDirectConversationBody.parse(req.body);
    requireAddress(input.walletAddress);
    requireAddress(input.fromWalletAddress);

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
    const { conversationId } = ListConversationMessagesParams.parse(req.params);
    const { walletAddress } = ListConversationMessagesQueryParams.parse(req.query);
    requireAddress(walletAddress);
    const rows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(asc(messagesTable.sentAt));
    res.json(rows.map((row) => ({
      ...row,
      body: decryptMessage(row.body),
      isMine: row.senderAddress === walletAddress,
    })));
  } catch {
    res.status(400).json({ error: "Unable to load this conversation." });
  }
});

router.post("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const { conversationId } = SendMessageParams.parse(req.params);
    const input = SendMessageBody.parse(req.body);
    requireAddress(input.senderAddress);

    const membership = await db
      .select()
      .from(conversationMembersTable)
      .where(
        and(
          eq(conversationMembersTable.conversationId, conversationId),
          eq(conversationMembersTable.walletAddress, input.senderAddress),
        ),
      )
      .limit(1);
    if (!membership[0]) {
      res.status(403).json({ error: "You are not a member of this conversation." });
      return;
    }

    const message = {
      id: `message-${randomUUID()}`,
      conversationId,
      senderAddress: input.senderAddress,
      body: encryptMessage(input.body.trim()),
      sentAt: new Date(),
      encrypted: true,
    };
    await db.insert(messagesTable).values(message);
    await db
      .update(conversationsTable)
      .set({ lastMessage: message.body, lastMessageAt: message.sentAt })
      .where(eq(conversationsTable.id, conversationId));
    res.status(201).json({ ...message, body: decryptMessage(message.body), isMine: true });
  } catch {
    res.status(400).json({ error: "Message could not be sent." });
  }
});

router.get("/groups", async (req, res) => {
  try {
    await ensureSeedGroups();
    const { walletAddress } = ListGroupsQueryParams.parse(req.query);
    requireAddress(walletAddress);
    const groups = await db.select().from(groupsTable);
    const memberships = await db
      .select()
      .from(groupMembersTable)
      .where(eq(groupMembersTable.walletAddress, walletAddress));
    const joined = new Set(memberships.map((member) => member.groupId));
    res.json(groups.map((group) => ({ ...group, isJoined: joined.has(group.id) })));
  } catch {
    res.status(400).json({ error: "Unable to load groups." });
  }
});

router.post("/groups", async (req, res) => {
  try {
    const input = CreateGroupBody.parse(req.body);
    requireAddress(input.creatorAddress);
    const groupId = `group-${randomUUID()}`;
    const conversationId = `conversation-${randomUUID()}`;
    const group = {
      id: groupId,
      conversationId,
      name: input.name.trim(),
      description: input.description.trim(),
      memberCount: 1,
      onlineCount: 1,
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
    const { groupId } = JoinGroupParams.parse(req.params);
    const { walletAddress } = JoinGroupBody.parse(req.body);
    requireAddress(walletAddress);
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
      .set({ memberCount: members.length })
      .where(eq(groupsTable.id, groupId));
    await db
      .update(conversationsTable)
      .set({ memberCount: members.length, participantLabel: `${members.length} members` })
      .where(eq(conversationsTable.id, group[0].conversationId));
    res.json({ ...group[0], memberCount: members.length, isJoined: true });
  } catch {
    res.status(400).json({ error: "Unable to join this group." });
  }
});

export default router;