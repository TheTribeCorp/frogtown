import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CircleAlert, ShieldCheck, Trash2 } from 'lucide-react';
import {
  getListPushSubscriptionsQueryKey,
  useListPushSubscriptions,
  useRevokePushSubscription,
} from '@workspace/api-client-react';
import {
  browserNotificationsEnabled,
  backgroundNotificationsConfigured,
  disableBackgroundNotifications,
  enableBackgroundNotifications,
  getActiveBackgroundSubscriptionId,
  getBrowserNotificationStatus,
  hasActiveBackgroundSubscription,
  type BrowserNotificationStatus,
} from '@/lib/browser-notifications';

function formatDeviceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function BrowserNotificationSettings({ walletAddress }: { walletAddress: string }) {
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<BrowserNotificationStatus>(() => getBrowserNotificationStatus());
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [currentSubscriptionId, setCurrentSubscriptionId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const subscriptionsQuery = useListPushSubscriptions({
    query: {
      enabled: Boolean(walletAddress),
      queryKey: [...getListPushSubscriptionsQueryKey(), walletAddress],
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  });
  const revokeSubscription = useRevokePushSubscription();

  useEffect(() => {
    let active = true;
    const currentPermission = getBrowserNotificationStatus();
    setPermission(currentPermission);
    setCurrentSubscriptionId(null);
    setChecking(true);
    setNotice('');
    void Promise.all([
      backgroundNotificationsConfigured().catch(() => false),
      hasActiveBackgroundSubscription(),
      getActiveBackgroundSubscriptionId(),
    ]).then(([pushConfigured, subscriptionActive, activeSubscriptionId]) => {
      if (!active) return;
      setConfigured(pushConfigured);
      setEnabled(currentPermission === 'granted'
        && browserNotificationsEnabled(walletAddress)
        && subscriptionActive);
      setCurrentSubscriptionId(activeSubscriptionId);
      setChecking(false);
    });
    return () => { active = false; };
  }, [walletAddress]);

  const toggleNotifications = async () => {
    setNotice('');
    if (enabled) {
      setBusy(true);
      try {
        await disableBackgroundNotifications(walletAddress);
        setEnabled(false);
        setCurrentSubscriptionId(null);
        await subscriptionsQuery.refetch();
        setNotice('Background message notifications are off for this device.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'This device could not be removed from notifications.');
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const result = await enableBackgroundNotifications(walletAddress);
      setPermission(getBrowserNotificationStatus());
      if (result === 'enabled') {
        setEnabled(true);
        setConfigured(true);
        setCurrentSubscriptionId(await getActiveBackgroundSubscriptionId());
        await subscriptionsQuery.refetch();
        setNotice('Background message notifications are on for this wallet on this device.');
      } else if (result === 'not-configured') {
        setConfigured(false);
        setNotice('Background notifications are not configured for this Frogtown deployment yet.');
      } else if (result === 'unsupported') {
        setNotice('This browser or connection does not support background push notifications.');
      } else {
        setEnabled(false);
        setNotice(getBrowserNotificationStatus() === 'denied'
          ? 'Notifications are blocked by your browser. Change this site’s permission in browser settings.'
          : 'Notification permission was not granted.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This device could not be registered for notifications.');
    } finally {
      setBusy(false);
    }
  };

  const revokeDevice = async (subscriptionId: string) => {
    setNotice('');
    setRevokingId(subscriptionId);
    try {
      if (subscriptionId === currentSubscriptionId) {
        await disableBackgroundNotifications(walletAddress);
        setEnabled(false);
        setCurrentSubscriptionId(null);
      } else {
        await revokeSubscription.mutateAsync({ subscriptionId });
      }
      await subscriptionsQuery.refetch();
      setNotice('That device can no longer receive Frogtown message alerts.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That device could not be removed from notifications.');
    } finally {
      setRevokingId(null);
    }
  };

  const unavailable = checking || !configured || permission === 'unsupported' || permission === 'denied';
  const description = permission === 'unsupported'
    ? 'This browser or connection does not support browser notifications.'
    : permission === 'denied'
      ? 'Notifications are blocked in browser settings. You can change the site permission there.'
      : checking
        ? 'Checking background notification support for this device…'
        : !configured
          ? 'Background notifications have not been configured for this Frogtown deployment yet.'
      : enabled
        ? 'Enabled on this device, including when Frogtown is closed. Message contents are never sent in a notification.'
        : 'Opt in to encrypted-message alerts even when Frogtown is closed. Message contents are never sent in a notification.';

  return (
    <section className="mt-5 rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6" data-testid="section-browser-notifications">
      <div className="flex items-start gap-4">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-[hsl(var(--primary)/.13)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]'}`}>
          {enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">message alerts</p>
          <h3 className="mt-1 font-semibold">Background message notifications</h3>
          <p className="mt-1 max-w-xl text-sm leading-5 text-[hsl(var(--muted-foreground))]" data-testid="text-browser-notification-description">{description}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4">
            <p className="flex items-start gap-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--primary))]" />
              <span>Alerts cover private chats and joined groups. They never include message contents.</span>
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Browser message notifications"
              disabled={busy || unavailable}
              onClick={() => void toggleNotifications()}
              className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${enabled ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground)/.28)]'}`}
              data-testid="switch-browser-notifications"
            >
              <span className={`absolute top-1 size-6 rounded-full bg-[hsl(var(--card))] shadow-sm transition-transform ${enabled ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
          {notice && (
            <p className={`mt-3 flex items-start gap-2 text-xs ${permission === 'denied' || permission === 'unsupported' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`} role={permission === 'denied' || permission === 'unsupported' ? 'alert' : 'status'} data-testid="status-browser-notifications">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {notice}
            </p>
          )}
          <div className="mt-5 border-t border-[hsl(var(--border))] pt-4" data-testid="notification-devices">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">Devices receiving alerts</h4>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  Revoke a device to stop it receiving new message alerts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void subscriptionsQuery.refetch()}
                disabled={subscriptionsQuery.isFetching || revokingId !== null}
                className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--muted)/.6)] disabled:opacity-50"
                data-testid="button-refresh-notification-devices"
              >
                Refresh
              </button>
            </div>
            {subscriptionsQuery.isLoading ? (
              <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]" role="status">Loading devices…</p>
            ) : subscriptionsQuery.isError ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <p className="text-[hsl(var(--destructive))]" role="alert">Notification devices could not be loaded.</p>
                <button
                  type="button"
                  onClick={() => void subscriptionsQuery.refetch()}
                  className="font-semibold text-[hsl(var(--primary))] underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : subscriptionsQuery.data?.subscriptions.length ? (
              <ul className="mt-3 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
                {subscriptionsQuery.data.subscriptions.map((device, index) => {
                  const isCurrentDevice = device.id === currentSubscriptionId;
                  return (
                    <li key={device.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {isCurrentDevice ? 'This device' : `Notification device ${index + 1}`}
                          {isCurrentDevice && <span className="ml-2 text-xs font-normal text-[hsl(var(--primary))]">Current</span>}
                        </p>
                        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                          Added {formatDeviceDate(device.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void revokeDevice(device.id)}
                        disabled={busy || revokingId !== null}
                        aria-label={`Revoke ${isCurrentDevice ? 'this device' : `notification device ${index + 1}`}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[hsl(var(--destructive)/.35)] px-3 py-2 text-xs font-medium text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.08)] disabled:opacity-50"
                        data-testid={`button-revoke-notification-device-${index + 1}`}
                      >
                        <Trash2 className="size-3.5" />
                        {revokingId === device.id ? 'Removing…' : 'Revoke'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                No notification-enabled devices are registered for this wallet.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
