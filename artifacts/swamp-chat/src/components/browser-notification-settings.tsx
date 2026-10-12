import { useEffect, useState } from 'react';
import { Bell, BellOff, CircleAlert, ShieldCheck } from 'lucide-react';
import {
  browserNotificationsEnabled,
  getBrowserNotificationStatus,
  requestBrowserNotificationPermission,
  setBrowserNotificationsEnabled,
  type BrowserNotificationStatus,
} from '@/lib/browser-notifications';

export function BrowserNotificationSettings({ walletAddress }: { walletAddress: string }) {
  const [permission, setPermission] = useState<BrowserNotificationStatus>(() => getBrowserNotificationStatus());
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const currentPermission = getBrowserNotificationStatus();
    setPermission(currentPermission);
    setEnabled(currentPermission === 'granted' && browserNotificationsEnabled(walletAddress));
    setNotice('');
  }, [walletAddress]);

  const toggleNotifications = async () => {
    setNotice('');
    if (enabled) {
      const saved = setBrowserNotificationsEnabled(walletAddress, false);
      if (!saved) {
        setNotice('This browser could not save your notification setting.');
        return;
      }
      setEnabled(false);
      return;
    }

    setBusy(true);
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      const saved = setBrowserNotificationsEnabled(walletAddress, true);
      if (saved) {
        setEnabled(true);
        setNotice('Browser notifications are on for this wallet on this device.');
      } else {
        setNotice('Permission was granted, but this browser could not save your preference.');
      }
    } else if (result === 'denied') {
      setEnabled(false);
      setNotice('Notifications are blocked by your browser. Change this site’s permission in browser settings.');
    } else if (result === 'unsupported') {
      setNotice('Browser notifications are not supported in this browser or connection.');
    } else {
      setNotice('Notification permission was not granted.');
    }
    setBusy(false);
  };

  const unavailable = permission === 'unsupported' || permission === 'denied';
  const description = permission === 'unsupported'
    ? 'This browser or connection does not support browser notifications.'
    : permission === 'denied'
      ? 'Notifications are blocked in browser settings. You can change the site permission there.'
      : enabled
        ? 'Enabled for this wallet in this browser. Alerts appear when Frogtown is in the background.'
        : 'Opt in to alerts when Frogtown is in the background. Message text is never shown in the notification.';

  return (
    <section className="mt-5 rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6" data-testid="section-browser-notifications">
      <div className="flex items-start gap-4">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-[hsl(var(--primary)/.13)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]'}`}>
          {enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">message alerts</p>
          <h3 className="mt-1 font-semibold">Browser notifications</h3>
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
        </div>
      </div>
    </section>
  );
}
