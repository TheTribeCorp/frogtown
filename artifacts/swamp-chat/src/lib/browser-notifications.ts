export type BrowserNotificationStatus = NotificationPermission | 'unsupported';

export type IncomingMessageNotification = {
  conversationId: string;
  messageId: string;
};

const enabledKey = (walletAddress: string) => `frogtown:browser-notifications:${walletAddress}`;
const recentNotificationsKey = (walletAddress: string) => `frogtown:recent-message-notifications:${walletAddress}`;

export function getBrowserNotificationStatus(): BrowserNotificationStatus {
  if (typeof window === 'undefined' || !window.isSecureContext || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function browserNotificationsEnabled(walletAddress: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(enabledKey(walletAddress)) === 'true';
  } catch {
    return false;
  }
}

export function setBrowserNotificationsEnabled(walletAddress: string, enabled: boolean): boolean {
  try {
    if (enabled) {
      window.localStorage.setItem(enabledKey(walletAddress), 'true');
    } else {
      window.localStorage.removeItem(enabledKey(walletAddress));
    }
    return true;
  } catch {
    return false;
  }
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  if (getBrowserNotificationStatus() === 'unsupported') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return getBrowserNotificationStatus();
  }
}

function claimNotification(walletAddress: string, messageId: string): boolean {
  try {
    const stored = window.localStorage.getItem(recentNotificationsKey(walletAddress));
    const previous: string[] = stored ? JSON.parse(stored) : [];
    if (previous.includes(messageId)) return false;
    window.localStorage.setItem(
      recentNotificationsKey(walletAddress),
      JSON.stringify([...previous.filter((id) => typeof id === 'string').slice(-39), messageId]),
    );
  } catch {
    // Continue if storage is unavailable; notification delivery is still useful in a single tab.
  }
  return true;
}

export function notifyIncomingMessage(
  walletAddress: string,
  message: IncomingMessageNotification,
  onClick: () => void,
): void {
  if (getBrowserNotificationStatus() !== 'granted'
    || !browserNotificationsEnabled(walletAddress)
    || (document.visibilityState === 'visible' && document.hasFocus())
    || !message.messageId
    || !message.conversationId
    || !claimNotification(walletAddress, message.messageId)) {
    return;
  }

  try {
    const notification = new Notification('New Frogtown message', {
      body: 'An encrypted message is waiting. Open Frogtown to read it.',
      tag: `frogtown-message-${message.messageId}`,
      data: { conversationId: message.conversationId },
    });
    notification.onclick = () => {
      notification.close();
      onClick();
    };
  } catch {
    // Browser permission can change between the status check and construction.
  }
}
