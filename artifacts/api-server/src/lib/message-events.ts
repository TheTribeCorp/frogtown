import { eq } from "drizzle-orm";
import { conversationMembersTable, db, pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

const EVENT_CHANNEL = "swamp_message_created";
const INSTANCE_ID = randomUUID();

export type MessageCreatedEvent = {
  conversationId: string;
  messageId: string;
};

type WalletListener = (event: MessageCreatedEvent) => void;

const listenersByWallet = new Map<string, Set<WalletListener>>();
let listenerClient: object | null = null;
let connecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

export function subscribeToWalletMessages(walletAddress: string, listener: WalletListener): () => void {
  let listeners = listenersByWallet.get(walletAddress);
  if (!listeners) {
    listeners = new Set();
    listenersByWallet.set(walletAddress, listeners);
  }
  listeners.add(listener);

  return () => {
    const activeListeners = listenersByWallet.get(walletAddress);
    activeListeners?.delete(listener);
    if (activeListeners?.size === 0) listenersByWallet.delete(walletAddress);
  };
}

function publishLocally(walletAddresses: string[], event: MessageCreatedEvent): void {
  for (const walletAddress of new Set(walletAddresses)) {
    for (const listener of listenersByWallet.get(walletAddress) ?? []) {
      try {
        listener(event);
      } catch {
        // A disconnected stream must not fail a message that is already committed.
      }
    }
  }
}

async function relayNotification(payload: string): Promise<void> {
  try {
    const data = JSON.parse(payload) as MessageCreatedEvent & { origin?: string };
    if (data.origin === INSTANCE_ID
      || typeof data.conversationId !== "string"
      || typeof data.messageId !== "string") return;

    const members = await db
      .select({ walletAddress: conversationMembersTable.walletAddress })
      .from(conversationMembersTable)
      .where(eq(conversationMembersTable.conversationId, data.conversationId));
    publishLocally(members.map((member) => member.walletAddress), data);
  } catch (error) {
    logger.error({ err: error }, "Could not relay a cross-instance message notification");
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectListener();
  }, 3000);
  reconnectTimer.unref();
}

async function connectListener(): Promise<void> {
  if (connecting || listenerClient) return;
  connecting = true;
  try {
    const client = await pool.connect();
    const activeClient = client;
    listenerClient = client;
    client.on("notification", (notification) => {
      if (notification.channel === EVENT_CHANNEL && notification.payload) {
        void relayNotification(notification.payload);
      }
    });
    client.on("error", (error) => {
      logger.error({ err: error }, "Message notification database listener disconnected");
      if (listenerClient === activeClient) {
        listenerClient = null;
        activeClient.release(true);
        scheduleReconnect();
      }
    });
    try {
      await client.query(`LISTEN ${EVENT_CHANNEL}`);
    } catch (error) {
      if (listenerClient === client) listenerClient = null;
      client.release(true);
      throw error;
    }
    logger.info("Listening for cross-instance message notifications");
  } catch (error) {
    logger.error({ err: error }, "Could not start message notification database listener");
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

export function startMessageEventListener(): void {
  void connectListener();
}

export async function publishMessageCreated(walletAddresses: string[], event: MessageCreatedEvent): Promise<void> {
  try {
    await pool.query("SELECT pg_notify($1, $2)", [
      EVENT_CHANNEL,
      JSON.stringify({ ...event, origin: INSTANCE_ID }),
    ]);
  } catch (error) {
    logger.error({ err: error }, "Could not publish cross-instance message notification");
  }
  publishLocally(walletAddresses, event);
}
