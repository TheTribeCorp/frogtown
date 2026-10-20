import webPush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { logger } from "./logger";
import { sendNativeMessagePush } from "./native-push";

export function isWebPushConfigured(): boolean {
  return Boolean(process.env.FROGTOWN_VAPID_PUBLIC_KEY && process.env.FROGTOWN_VAPID_PRIVATE_KEY);
}

function configureWebPush(subject: string): boolean {
  const publicKey = process.env.FROGTOWN_VAPID_PUBLIC_KEY;
  const privateKey = process.env.FROGTOWN_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  try {
    const parsedSubject = new URL(subject);
    if (parsedSubject.protocol !== "https:" && parsedSubject.protocol !== "mailto:") return false;
    webPush.setVapidDetails(
      process.env.FROGTOWN_VAPID_SUBJECT || subject,
      publicKey,
      privateKey,
    );
    return true;
  } catch (error) {
    logger.error({ err: error }, "Web push VAPID configuration is invalid");
    return false;
  }
}

export async function sendNewMessagePush(
  recipientWallets: string[],
  senderAddress: string,
  conversationId: string,
  messageId: string,
  requestSubject: string,
): Promise<void> {
  const recipients = [...new Set(recipientWallets.filter((wallet) => wallet !== senderAddress))];
  if (recipients.length === 0) return;
  await sendNativeMessagePush(recipients, conversationId, messageId);
  if (!configureWebPush(requestSubject)) return;

  try {
    const subscriptions = await db
      .select({
        endpoint: pushSubscriptionsTable.endpoint,
        p256dh: pushSubscriptionsTable.p256dh,
        auth: pushSubscriptionsTable.auth,
      })
      .from(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.walletAddress, recipients));
    const payload = JSON.stringify({
      title: "New Frogtown message",
      conversationId,
      messageId,
    });
    await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 60, urgency: "normal", timeout: 5_000 });
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.endpoint, subscription.endpoint));
          return;
        }
        logger.warn({ statusCode: Number.isFinite(statusCode) ? statusCode : 0 }, "Background message push could not be delivered");
      }
    }));
  } catch (error) {
    logger.warn({ err: error }, "Background message pushes could not be prepared");
  }
}
