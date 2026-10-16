export type BrowserNotificationStatus = NotificationPermission | 'unsupported';
export type BackgroundNotificationSetup = 'enabled' | 'denied' | 'unsupported' | 'not-configured';

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

async function getPushConfig(): Promise<{ enabled: boolean; publicKey?: string }> {
  const response = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
  if (!response.ok) throw new Error('Frogtown could not check background notification setup.');
  return response.json() as Promise<{ enabled: boolean; publicKey?: string }>;
}

function decodeApplicationServerKey(encoded: string): ArrayBuffer {
  const padded = `${encoded}${'='.repeat((4 - (encoded.length % 4)) % 4)}`;
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

function appBaseUrl(): URL {
  return new URL(import.meta.env.BASE_URL, window.location.origin);
}

async function getAppServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return undefined;
  const base = appBaseUrl();
  return navigator.serviceWorker.getRegistration(base.pathname);
}

export async function backgroundNotificationsConfigured(): Promise<boolean> {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const config = await getPushConfig();
  return Boolean(config.enabled && config.publicKey);
}

export async function hasActiveBackgroundSubscription(): Promise<boolean> {
  try {
    const registration = await getAppServiceWorkerRegistration();
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function enableBackgroundNotifications(
  walletAddress: string,
): Promise<BackgroundNotificationSetup> {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }

  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) return 'not-configured';

  const permission = await requestBrowserNotificationPermission();
  if (permission === 'unsupported') return 'unsupported';
  if (permission !== 'granted') return 'denied';

  const base = appBaseUrl();
  const script = new URL('service-worker.js', base);
  const registration = await navigator.serviceWorker.register(script, { scope: base.pathname });
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  const createdHere = !subscription;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    });
  }

  const response = await fetch('/api/push/subscriptions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) {
    if (createdHere) await subscription.unsubscribe().catch(() => false);
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || 'This device could not be registered for notifications.');
  }

  if (!setBrowserNotificationsEnabled(walletAddress, true)) {
    await fetch('/api/push/subscriptions', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
    throw new Error('Notifications were enabled, but this browser could not save the setting.');
  }
  return 'enabled';
}

export async function disableBackgroundNotifications(walletAddress: string): Promise<void> {
  const registration = await getAppServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const response = await fetch('/api/push/subscriptions', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!response.ok) throw new Error('This device could not be removed from Frogtown notifications.');
    await subscription.unsubscribe();
  }
  if (!setBrowserNotificationsEnabled(walletAddress, false)) {
    throw new Error('This browser could not save your notification setting.');
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
