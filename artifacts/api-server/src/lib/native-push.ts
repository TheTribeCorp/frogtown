import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { nativePushDevicesTable } from "@workspace/db/schema";
import { logger } from "./logger";

export async function sendNativeMessagePush(recipients: string[], conversationId: string, messageId: string) {
  if (!recipients.length) return;
  try {
    const devices = await db.select({ id: nativePushDevicesTable.id, token: nativePushDevicesTable.token })
      .from(nativePushDevicesTable).where(inArray(nativePushDevicesTable.walletAddress, recipients));
    for (let start = 0; start < devices.length; start += 100) {
      const batch = devices.slice(start, start + 100);
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch.map((device) => ({
          to: device.token, title: "New Frogtown message",
          body: "An encrypted message is waiting. Open Frogtown to read it.",
          data: { conversationId, messageId }, sound: "default", channelId: "messages",
          ttl: 300,
        }))),
      });
      if (!response.ok) { logger.warn({ status: response.status }, "Native push service rejected delivery"); continue; }
      const result = await response.json() as { data?: { status: string; details?: { error?: string } }[] };
      await Promise.all((result.data ?? []).map(async (ticket, index) => {
        if (ticket.details?.error === "DeviceNotRegistered" && batch[index]) {
          await db.delete(nativePushDevicesTable).where(eq(nativePushDevicesTable.id, batch[index].id));
        } else if (ticket.status === "error") {
          logger.warn({ code: ticket.details?.error }, "Native push ticket was rejected");
        }
      }));
    }
  } catch {
    // Never log tokens, wallet addresses, or notification payloads.
    logger.warn("Native new-message alerts could not be delivered");
  }
}
