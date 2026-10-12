import { useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  BadgeCheck,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Copy,
  DoorOpen,
  ExternalLink,
  Hash,
  KeyRound,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  Rss,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  WalletCards,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  getGetWalletSessionQueryKey,
  getGetCurrentWalletQueryKey,
  getGetGamificationLeaderboardQueryKey,
  getGetGamificationSummaryQueryKey,
  getHealthCheckQueryKey,
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
  getListGroupsQueryKey,
  useCreateDirectConversation,
  useCreateGroup,
  useCreateWalletSession,
  useGetConversationEncryptionKeys,
  useGetCurrentWallet,
  useGetWalletSession,
  useHealthCheck,
  useJoinGroup,
  useListConversationMessages,
  useListConversations,
  useListGroups,
  useMarkConversationRead,
  useLogoutWallet,
  useSendMessage,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { BrowserNotificationSettings } from '@/components/browser-notification-settings';
import { EncryptionRecoveryPanel } from '@/components/encryption-recovery';
import { TimelinePage } from '@/components/timeline-page';
import { DailyQuestsPage } from '@/components/daily-quests-page';
import { notifyIncomingMessage } from '@/lib/browser-notifications';
import {
  conversationSafetyCode,
  decryptForConversation,
  encryptForConversation,
  ensureIdentityKey,
  getLocalIdentityKey,
  type ConversationPublicKey,
} from '@/lib/e2ee';

const queryClient = new QueryClient();

type WalletContextValue = {
  walletAddress: string;
  setWalletAddress: (address: string) => void;
  disconnect: () => void;
};

type RealtimeStatus = 'live' | 'reconnecting';

const WalletContext = createContext<WalletContextValue | null>(null);
const RealtimeContext = createContext<RealtimeStatus>('reconnecting');

function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('Wallet context is missing');
  return value;
}

function RealtimeBridge({ children }: { children: ReactNode }) {
  const { walletAddress } = useWallet();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<RealtimeStatus>('reconnecting');

  useEffect(() => {
    if (!walletAddress) {
      setStatus('reconnecting');
      return;
    }

    const source = new EventSource('/api/events', { withCredentials: true });
    const refreshConversationData = () => {
      void client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
      void client.invalidateQueries({
        predicate: (query) => {
          const path = query.queryKey[0];
          return typeof path === 'string'
            && path.startsWith('/api/conversations/')
            && path.endsWith('/messages');
        },
      });
    };

    source.onopen = () => {
      setStatus('live');
      refreshConversationData();
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          conversationId?: string;
          messageId?: string;
          senderAddress?: string;
        };
        if (!payload.conversationId) return;
        if (payload.type === 'message.created') {
          void client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
          void client.invalidateQueries({
            queryKey: getListConversationMessagesQueryKey(payload.conversationId, { walletAddress }),
          });
          window.dispatchEvent(new CustomEvent('swamp-message-created', { detail: payload }));
          if (payload.senderAddress && payload.senderAddress !== walletAddress && payload.messageId) {
            notifyIncomingMessage(walletAddress, {
              conversationId: payload.conversationId,
              messageId: payload.messageId,
            }, () => {
              window.focus();
              window.sessionStorage.setItem(`swamp-selected-conversation:${walletAddress}`, payload.conversationId!);
              setLocation('/');
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent('swamp-select-conversation', { detail: payload.conversationId }));
              }, 0);
            });
          }
          return;
        }
        if (payload.type === 'message.read') {
          void client.invalidateQueries({
            queryKey: getListConversationMessagesQueryKey(payload.conversationId, { walletAddress }),
          });
        }
      } catch {
        // Ignore malformed notifications; persisted message history remains authoritative.
      }
    };
    source.onerror = () => setStatus('reconnecting');

    const recoverWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshConversationData();
    };
    document.addEventListener('visibilitychange', recoverWhenVisible);
    window.addEventListener('online', recoverWhenVisible);

    return () => {
      source.close();
      document.removeEventListener('visibilitychange', recoverWhenVisible);
      window.removeEventListener('online', recoverWhenVisible);
    };
  }, [walletAddress, client, setLocation]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}

function shortAddress(address: string, start = 7, end = 5) {
  if (!address) return 'Not connected';
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

function relativeTime(value: string | null) {
  if (!value) return 'No messages yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Notice({ message, tone = 'info', onClose }: { message: string; tone?: 'info' | 'error' | 'success'; onClose: () => void }) {
  const tones = {
    info: 'border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--foreground))]',
    error: 'border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]',
    success: 'border-[hsl(var(--primary)/.3)] bg-[hsl(var(--primary)/.12)] text-[hsl(var(--foreground))]',
  };
  return (
    <div className={`fixed bottom-5 right-5 z-50 flex max-w-[min(92vw,380px)] items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${tones[tone]}`} data-testid="status-notice">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 leading-5">{message}</p>
      <button className="opacity-60 transition hover:opacity-100" onClick={onClose} aria-label="Dismiss notification" data-testid="button-dismiss-notice"><X className="size-4" /></button>
    </div>
  );
}

function FrogtownMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? '' : 'select-none'}`}>
      <div className="relative flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] shadow-[3px_3px_0_hsl(var(--accent))]">
        <span className="mono text-lg font-medium tracking-[-.2em]">≈</span>
        <span className="absolute -bottom-1 -right-1 size-2 rounded-full bg-[hsl(var(--sidebar-accent))]" />
      </div>
      {!compact && <span className="text-lg font-bold tracking-[-.04em] text-[hsl(var(--sidebar-foreground))]">Frogtown</span>}
    </div>
  );
}

function WalletPill({ address, onClick }: { address: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="relative flex size-7 items-center justify-center rounded-lg bg-[hsl(var(--sidebar-accent)/.18)] text-[hsl(var(--sidebar-accent))]">
        <span className="size-2 rounded-full bg-[hsl(var(--sidebar-accent))] pulse-dot" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-[9px] uppercase tracking-[.17em] text-[hsl(var(--sidebar-foreground)/.52)]">wallet identity</span>
        <span className="mono block truncate text-xs text-[hsl(var(--sidebar-foreground))]" data-testid="text-sidebar-wallet">{shortAddress(address)}</span>
      </span>
      <BadgeCheck className="ml-auto size-4 text-[hsl(var(--sidebar-accent))]" />
    </>
  );
  return onClick ? (
    <button className="flex w-full items-center gap-2.5 rounded-xl border border-[hsl(var(--sidebar-foreground)/.1)] bg-[hsl(var(--sidebar-foreground)/.05)] p-2.5 text-left transition hover:bg-[hsl(var(--sidebar-foreground)/.1)]" onClick={onClick} data-testid="button-wallet-identity">
      {body}
    </button>
  ) : (
    <div className="flex w-full items-center gap-2.5 rounded-xl border border-[hsl(var(--sidebar-foreground)/.1)] bg-[hsl(var(--sidebar-foreground)/.05)] p-2.5">{body}</div>
  );
}

function Sidebar({ mobileOpen, onClose, onNewChat }: { mobileOpen: boolean; onClose: () => void; onNewChat: () => void }) {
  const { walletAddress, disconnect } = useWallet();
  const [location] = useLocation();
  return (
    <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} fixed inset-y-0 left-0 z-30 flex w-[286px] flex-col bg-[hsl(var(--sidebar))] px-4 py-5 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:relative md:translate-x-0`} data-testid="navigation-sidebar">
      <div className="flex items-center justify-between px-2">
        <Link href="/" className="no-underline" onClick={onClose} data-testid="link-brand"><FrogtownMark /></Link>
        <button className="rounded-lg p-1.5 text-[hsl(var(--sidebar-foreground)/.55)] hover:bg-[hsl(var(--sidebar-foreground)/.08)] md:hidden" onClick={onClose} aria-label="Close navigation" data-testid="button-close-navigation"><X className="size-5" /></button>
      </div>
      <div className="mt-10">
        <p className="px-2 text-[10px] font-medium uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.42)]">the $HERMIT community</p>
        <nav className="mt-3 space-y-1" aria-label="Primary navigation">
          <Link href="/" onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${location === '/' ? 'bg-[hsl(var(--sidebar-foreground)/.1)] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.62)] hover:bg-[hsl(var(--sidebar-foreground)/.06)] hover:text-[hsl(var(--sidebar-foreground))]'}`} data-testid="link-chat"><MessageCircle className="size-[17px]" /><span>Chats</span><span className="mono ml-auto text-[10px] text-[hsl(var(--sidebar-foreground)/.35)]">01</span></Link>
          <Link href="/groups" onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${location === '/groups' ? 'bg-[hsl(var(--sidebar-foreground)/.1)] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.62)] hover:bg-[hsl(var(--sidebar-foreground)/.06)] hover:text-[hsl(var(--sidebar-foreground))]'}`} data-testid="link-groups"><Users className="size-[17px]" /><span>Community rooms</span><ArrowUpRight className="ml-auto size-3.5 opacity-35" /></Link>
          <Link href="/timeline" onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${location === '/timeline' ? 'bg-[hsl(var(--sidebar-foreground)/.1)] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.62)] hover:bg-[hsl(var(--sidebar-foreground)/.06)] hover:text-[hsl(var(--sidebar-foreground))]'}`} data-testid="link-timeline"><Rss className="size-[17px]" /><span>Timeline</span><ArrowUpRight className="ml-auto size-3.5 opacity-35" /></Link>
          <Link href="/quests" onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${location === '/quests' ? 'bg-[hsl(var(--sidebar-foreground)/.1)] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.62)] hover:bg-[hsl(var(--sidebar-foreground)/.06)] hover:text-[hsl(var(--sidebar-foreground))]'}`} data-testid="link-quests"><Trophy className="size-[17px]" /><span>Daily quests</span><ArrowUpRight className="ml-auto size-3.5 opacity-35" /></Link>
        </nav>
      </div>
      <div className="mt-8">
        <div className="flex items-center justify-between px-2">
          <p className="text-[10px] font-medium uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.42)]">your space</p>
          <button className="rounded-md p-1 text-[hsl(var(--sidebar-foreground)/.42)] hover:bg-[hsl(var(--sidebar-foreground)/.08)] hover:text-[hsl(var(--sidebar-accent))]" onClick={onNewChat} aria-label="Start a direct chat" data-testid="button-sidebar-new-chat"><Plus className="size-4" /></button>
        </div>
        <div className="mt-3 space-y-1">
          <button onClick={onNewChat} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-foreground)/.08)] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="button-sidebar-start-direct"><AtSign className="size-[17px] text-[hsl(var(--sidebar-accent))]" /><span>New direct chat</span><Plus className="ml-auto size-3.5 opacity-45" /></button>
          <Link href="/groups" onClick={onClose} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-foreground)/.08)] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="button-sidebar-find-groups"><Hash className="size-[17px] text-[hsl(var(--accent))]" /><span>Find group rooms</span><ArrowUpRight className="ml-auto size-3.5 opacity-45" /></Link>
        </div>
      </div>
      <div className="mt-auto space-y-3">
        <Link href="/settings" onClick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-foreground)/.06)] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="link-settings"><Settings2 className="size-[17px]" /><span>Settings</span></Link>
        <Link href="/settings/recovery" onClick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[hsl(var(--sidebar-foreground)/.62)] transition hover:bg-[hsl(var(--sidebar-foreground)/.06)] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="link-key-recovery"><KeyRound className="size-[17px]" /><span>Chat recovery</span></Link>
        {walletAddress && <WalletPill address={walletAddress} />}
        <button onClick={disconnect} className="flex w-full items-center gap-2 px-2 text-xs text-[hsl(var(--sidebar-foreground)/.38)] transition hover:text-[hsl(var(--accent))]" data-testid="button-disconnect"><LogOut className="size-3.5" /> Disconnect wallet</button>
      </div>
    </aside>
  );
}

function Header({ title, eyebrow, onMenu }: { title: string; eyebrow: string; onMenu: () => void }) {
  return (
    <header className="flex min-h-[76px] items-center justify-between border-b border-[hsl(var(--border)/.75)] px-5 py-4 md:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden" aria-label="Open navigation" data-testid="button-open-navigation"><Menu className="size-5" /></button>
        <div>
          <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-[-.04em] md:text-2xl" data-testid="text-page-title">{title}</h1>
        </div>
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <span className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"><span className="size-1.5 rounded-full bg-[hsl(var(--primary))] pulse-dot" /> XRPL mainnet</span>
      </div>
    </header>
  );
}

function AppShell({ children, title, eyebrow, onNewChat }: { children: ReactNode; title: string; eyebrow: string; onNewChat?: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [, setLocation] = useLocation();
  const startChat = onNewChat ?? (() => setLocation('/'));
  return (
    <div className="swamp-app noise flex min-h-[100dvh] overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} onNewChat={startChat} />
      {mobileOpen && <button className="fixed inset-0 z-20 bg-[hsl(var(--foreground)/.32)] md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-navigation-overlay" />}
      <main className="flex min-w-0 flex-1 flex-col">
        <Header title={title} eyebrow={eyebrow} onMenu={() => setMobileOpen(true)} />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

function WalletEntry() {
  const { setWalletAddress } = useWallet();
  const [, setLocation] = useLocation();
  const createSession = useCreateWalletSession();
  const [session, setSession] = useState<{ sessionId: string; qrUrl: string; deeplink: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'info' | 'success' } | null>(null);
  const statusQuery = useGetWalletSession(session?.sessionId ?? '', {
    query: {
      enabled: Boolean(session?.sessionId),
      queryKey: getGetWalletSessionQueryKey(session?.sessionId ?? ''),
      refetchInterval: 1500,
    },
  });
  const status = statusQuery.data;

  useEffect(() => {
    if (status?.status === 'connected' && status.walletAddress) {
      const requestedPath = window.sessionStorage.getItem('frogtown-signin-return-to');
      window.sessionStorage.removeItem('frogtown-signin-return-to');
      const destination = requestedPath && ['/', '/groups', '/timeline', '/settings', '/settings/recovery'].includes(requestedPath)
        ? requestedPath
        : '/';
      setWalletAddress(status.walletAddress);
      setLocation(destination);
      setNotice({ message: 'Wallet connected. Welcome to Frogtown.', tone: 'success' });
      setSession(null);
    }
    if (status?.status === 'expired') {
      setNotice({ message: 'That Xaman session expired. Start a fresh sign-in.', tone: 'error' });
      setSession(null);
    }
  }, [setLocation, setWalletAddress, status?.status, status?.walletAddress]);

  const connect = () => {
    setNotice(null);
    createSession.mutate(undefined, {
      onSuccess: (created) => setSession(created),
      onError: (error) => setNotice({ message: errorMessage(error, 'Xaman could not open a session right now.'), tone: 'error' }),
    });
  };

  return (
    <div className="swamp-app noise min-h-[100dvh] overflow-hidden">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1500px] flex-col lg:flex-row">
        <section className="relative flex min-h-[46dvh] flex-1 flex-col justify-between overflow-hidden bg-[hsl(var(--sidebar))] px-6 py-7 text-[hsl(var(--sidebar-foreground))] md:px-12 lg:min-h-[100dvh] lg:max-w-[51%] lg:px-16 lg:py-10">
          <div className="absolute -right-32 -top-32 size-96 rounded-full border-[1px] border-[hsl(var(--secondary)/.17)]" />
          <div className="absolute -right-12 top-10 size-44 rounded-full border-[1px] border-[hsl(var(--accent)/.28)]" />
          <div className="absolute bottom-[-15%] left-[-10%] size-80 rounded-full bg-[hsl(var(--primary)/.16)] blur-3xl" />
          <div className="relative z-10 flex items-center justify-between"><FrogtownMark /><span className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.45)]">XRPL / $HERMIT</span></div>
          <div className="relative z-10 my-12 max-w-xl lg:my-0">
            <p className="mono mb-5 text-xs uppercase tracking-[.24em] text-[hsl(var(--sidebar-accent))]">$HERMIT community / XRPL</p>
            <h1 className="max-w-[680px] text-[clamp(3.4rem,8vw,7.6rem)] font-semibold leading-[.87] tracking-[-.085em]">Frogtown<br /><span className="text-[hsl(var(--sidebar-accent))]">brings us closer.</span></h1>
            <p className="mt-8 max-w-md text-base leading-7 text-[hsl(var(--sidebar-foreground)/.62)] md:text-lg">Meet the home for $HERMIT, the chill frog of the XRPL. Connect your Xaman wallet to join encrypted chats, community rooms, and a shared timeline—bringing the people behind the ledger together.</p>
          </div>
          <div className="relative z-10 flex items-end justify-between gap-8">
            <div><p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.38)]">built for the XRPL community</p><div className="mt-3 flex items-center gap-2 text-sm text-[hsl(var(--sidebar-foreground)/.68)]"><span className="size-2 rounded-full bg-[hsl(var(--sidebar-accent))]" /> One ledger. Many voices.</div></div>
            <div className="mono hidden text-right text-[10px] leading-5 text-[hsl(var(--sidebar-foreground)/.38)] sm:block">your address<br />is enough.</div>
          </div>
        </section>
        <section className="wallet-grid flex flex-1 items-center justify-center px-6 py-12 md:px-12 lg:max-w-[49%]">
          <div className="w-full max-w-[460px]">
            <div className="appear">
              <div className="mb-7 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><span className="mono rounded-full bg-[hsl(var(--primary)/.11)] px-2 py-1 text-[10px] text-[hsl(var(--primary))]">01</span><span>Connect to enter</span><span className="h-px flex-1 bg-[hsl(var(--border))]" /><span className="mono text-[10px]">XAMAN</span></div>
              <h2 className="text-4xl font-semibold leading-[.98] tracking-[-.07em] md:text-5xl">Your people<br />are in Frogtown.</h2>
              <p className="mt-5 max-w-sm leading-6 text-[hsl(var(--muted-foreground))]">Connect with Xaman to join the $HERMIT community. Your XRPL address is your identity; your private chats are encrypted on your device.</p>
            </div>
            {!session ? (
              <div className="appear appear-delay-1 mt-10 rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 shadow-[0_18px_60px_hsl(174_25%_13%/.08)]">
                <div className="flex items-start gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><WalletCards className="size-5" /></div><div><p className="font-semibold">Connect your XRPL wallet</p><p className="mt-1 text-sm leading-5 text-[hsl(var(--muted-foreground))]">Sign in securely with Xaman and make your address your Frogtown identity.</p></div></div>
                <button onClick={connect} disabled={createSession.isPending} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3.5 text-sm font-medium text-[hsl(var(--card))] transition hover:-translate-y-0.5 hover:bg-[hsl(var(--primary))] disabled:cursor-wait disabled:opacity-60" data-testid="button-connect-wallet">{createSession.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4 text-[hsl(var(--sidebar-accent))]" />}{createSession.isPending ? 'Opening Xaman…' : 'Connect with Xaman'}<ArrowRight className="ml-auto size-4 opacity-60" /></button>
                <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><LockKeyhole className="size-3" /> Encrypted conversations · XRPL mainnet</div>
              </div>
            ) : (
              <div className="appear mt-10 rounded-[1.35rem] border border-[hsl(var(--primary)/.3)] bg-[hsl(var(--card)/.82)] p-5 shadow-[0_18px_60px_hsl(174_25%_13%/.08)]">
                <div className="flex items-start gap-4"><div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"><QrCode className="size-6" /><span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-[hsl(var(--primary))] pulse-dot" /></div><div><p className="font-semibold">Waiting for Xaman</p><p className="mt-1 text-sm leading-5 text-[hsl(var(--muted-foreground))]">{statusQuery.isFetching ? 'Listening for your approval…' : 'Scan the code or open the app.'}</p></div></div>
                <div className="mt-6 grid gap-4 sm:grid-cols-[140px_1fr]"><div className="flex aspect-square items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--foreground))] p-3"><img src={session.qrUrl} alt="Xaman wallet connection QR code" className="size-full rounded-md bg-[hsl(var(--card))]" data-testid="img-wallet-qr" /></div><div className="flex flex-col justify-between"><div><p className="mono break-all text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">{session.sessionId}</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your address never leaves the connection you approve.</p></div><a href={session.deeplink} className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2.5 text-xs font-medium transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid="link-open-xaman">Open Xaman <ExternalLink className="size-3.5" /></a></div></div>
                <button className="mt-5 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" onClick={() => setSession(null)} data-testid="button-cancel-wallet">Cancel and start over <ChevronRight className="size-3.5" /></button>
              </div>
            )}
            <div className="appear appear-delay-2 mt-7 grid grid-cols-3 gap-3 text-center"><div><p className="text-lg font-semibold">01</p><p className="mono mt-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">wallet</p></div><div><p className="text-lg font-semibold">0</p><p className="mono mt-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">profiles</p></div><div><p className="text-lg font-semibold">∞</p><p className="mono mt-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">signal</p></div></div>
          </div>
        </section>
      </div>
      {notice && <Notice message={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}
    </div>
  );
}

function DirectChatDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (conversationId: string) => void }) {
  const { walletAddress } = useWallet();
  const createDirect = useCreateDirectConversation();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const client = useQueryClient();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (address.trim().length < 25) {
      setError('Paste a complete XRPL address to start a direct chat.');
      return;
    }
    createDirect.mutate({ data: { walletAddress: address.trim(), fromWalletAddress: walletAddress } }, {
      onSuccess: (conversation) => {
        client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
        onCreated(conversation.id);
      },
      onError: (mutationError) => setError(errorMessage(mutationError, 'Could not start that conversation.')),
    });
  };
  return <Modal title="Start a direct line" eyebrow="private / one-to-one" onClose={onClose}>
    <form onSubmit={submit}>
      <label className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]" htmlFor="xrpl-address">XRPL wallet address</label>
      <div className="relative mt-2"><AtSign className="absolute left-3 top-3.5 size-4 text-[hsl(var(--muted-foreground))]" /><input id="xrpl-address" autoFocus value={address} onChange={(event) => setAddress(event.target.value)} placeholder="r… recipient address" className="mono w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] py-3 pl-10 pr-3 text-sm outline-none transition placeholder:text-[hsl(var(--muted-foreground)/.6)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.13)]" data-testid="input-direct-address" /></div>
      <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Addresses are names here. No handle, avatar, or contact upload required.</p>
      {error && <p className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-direct-error"><CircleAlert className="size-3.5" />{error}</p>}
      <button disabled={createDirect.isPending} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))] disabled:opacity-60" data-testid="button-start-direct-chat">{createDirect.isPending ? <RefreshCw className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} {createDirect.isPending ? 'Opening line…' : 'Open conversation'}</button>
    </form>
  </Modal>;
}

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.35)] p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" data-testid="dialog-modal"><div className="w-full max-w-[480px] rounded-t-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl sm:rounded-[1.5rem] sm:p-7"><div className="flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.05em]">{title}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Close dialog" data-testid="button-close-dialog"><X className="size-5" /></button></div><div className="mt-6">{children}</div></div></div>;
}

function ChatList({ conversations, selectedId, onSelect, onNewChat, loading, error }: { conversations: Array<{ id: string; title: string; participantLabel: string; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number; encrypted: boolean; type: string }>; selectedId: string; onSelect: (id: string) => void; onNewChat: () => void; loading: boolean; error: unknown }) {
  const [search, setSearch] = useState('');
  const filteredConversations = conversations.filter((conversation) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return `${conversation.title} ${conversation.participantLabel}`.toLowerCase().includes(query);
  });
  return <section className="flex w-full shrink-0 flex-col border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.36)] md:w-[340px] md:border-b-0 md:border-r" data-testid="conversation-list">
    <div className="flex items-center justify-between px-4 pb-3 pt-5"><div><p className="mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">inbox</p><h2 className="mt-1 text-lg font-semibold tracking-[-.04em]">Chats</h2></div><button onClick={onNewChat} className="flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--foreground))] text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))]" aria-label="Start new conversation" data-testid="button-new-chat"><Plus className="size-4" /></button></div>
    <div className="px-4 pb-4"><label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))] focus-within:border-[hsl(var(--primary))]"><Search className="size-3.5 shrink-0" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats or paste an address" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[hsl(var(--muted-foreground)/.72)]" aria-label="Search chats" data-testid="input-search-chats" /><span className="mono text-[9px] opacity-50">/</span></label></div>
    <div className="soft-scrollbar flex max-h-[250px] flex-1 flex-col gap-1 overflow-auto px-2 pb-3 md:max-h-none">
      {loading && [1, 2, 3].map((item) => <div key={item} className="mx-2 animate-pulse rounded-xl px-3 py-3"><div className="h-3 w-2/5 rounded bg-[hsl(var(--muted))]" /><div className="mt-2 h-2 w-3/4 rounded bg-[hsl(var(--muted))]" /></div>)}
      {!loading && Boolean(error) && <div className="m-2 rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] p-3 text-xs leading-5 text-[hsl(var(--destructive))]" data-testid="status-conversations-error">Unable to load your conversations. Try refreshing the page.</div>}
      {!loading && !error && conversations.length === 0 && <div className="m-2 rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="empty-conversations"><MessageCircle className="mb-3 size-4 text-[hsl(var(--primary))]" /><p>No conversations yet.</p><p className="mt-1">Start a private line or find a group room.</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={onNewChat} className="rounded-lg bg-[hsl(var(--foreground))] px-3 py-2 font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]" data-testid="button-empty-new-chat">New direct chat</button><Link href="/groups" className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-medium text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]" data-testid="button-empty-browse-groups">Browse groups</Link></div></div>}
      {!loading && !error && conversations.length > 0 && filteredConversations.length === 0 && <div className="m-2 rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="empty-search-chats"><Search className="mb-3 size-4 text-[hsl(var(--primary))]" /><p>No chats match “{search}”.</p><button onClick={() => setSearch('')} className="mt-2 font-medium text-[hsl(var(--primary))] hover:underline">Clear search</button></div>}
      {filteredConversations.map((conversation) => <button key={conversation.id} onClick={() => onSelect(conversation.id)} className={`group w-full rounded-xl px-3 py-3 text-left transition ${selectedId === conversation.id ? 'bg-[hsl(var(--primary)/.1)]' : 'hover:bg-[hsl(var(--muted)/.7)]'}`} data-testid={`button-conversation-${conversation.id}`}><div className="flex items-start gap-3"><div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${conversation.type === 'group' ? 'bg-[hsl(var(--accent)/.18)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]'}`}>{conversation.type === 'group' ? <Hash className="size-4" /> : <AtSign className="size-4" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{conversation.title || conversation.participantLabel}</span>{conversation.encrypted && <LockKeyhole className="size-3 shrink-0 text-[hsl(var(--primary))]" />}{conversation.unreadCount > 0 && <span className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[9px] font-bold text-[hsl(var(--accent-foreground))]">{conversation.unreadCount}</span>}</div><p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">{conversation.lastMessage || 'No messages yet'}</p></div><span className="mono shrink-0 text-[9px] text-[hsl(var(--muted-foreground)/.7)]">{relativeTime(conversation.lastMessageAt)}</span></div></button>)}
    </div>
  </section>;
}

function MessagePane({ conversation, onBack, isActive }: { conversation: { id: string; title: string; participantLabel: string; encrypted: boolean; memberCount: number; type: string } | undefined; onBack: () => void; isActive: boolean }) {
  const { walletAddress } = useWallet();
  const realtimeStatus = useContext(RealtimeContext);
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [encrypting, setEncrypting] = useState(false);
  const messageAttempt = useRef<{ conversationId: string; body: string; messageId: string } | null>(null);
  const [showSafetyCode, setShowSafetyCode] = useState(false);
  const [safetyCode, setSafetyCode] = useState('');
  const [decryptedMessages, setDecryptedMessages] = useState<Array<{ id: string; conversationId: string; senderAddress: string; body: string; sentAt: string; isMine: boolean; encrypted: boolean; isRead: boolean; decryptionFailed: boolean }>>([]);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const lastMarkedMessageId = useRef<string | null>(null);
  const pendingReadMessageId = useRef<string | null>(null);
  const params = useMemo(() => ({ walletAddress }), [walletAddress]);
  const messagesQuery = useListConversationMessages(conversation?.id ?? '', params, { query: { enabled: Boolean(conversation?.id), queryKey: getListConversationMessagesQueryKey(conversation?.id ?? '', params), refetchInterval: 30000 } });
  const keysQuery = useGetConversationEncryptionKeys(conversation?.id ?? '', { query: { enabled: Boolean(conversation?.id), queryKey: ['/api/conversations', conversation?.id, 'keys'], refetchInterval: 15000 } });
  const sendMessage = useSendMessage();
  const markConversationRead = useMarkConversationRead();
  const members: ConversationPublicKey[] = keysQuery.data ?? [];
  const missingMembers = members.filter((member) => !member.publicKey);

  useEffect(() => {
    setDraft('');
    setSendError('');
    messageAttempt.current = null;
    lastMarkedMessageId.current = null;
    pendingReadMessageId.current = null;
  }, [conversation?.id]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    const handleMessageCreated = (event: Event) => {
      const payload = (event as CustomEvent<{ conversationId?: string; messageId?: string }>).detail;
      const activeAttempt = messageAttempt.current;
      if (activeAttempt
        && payload?.messageId
        && activeAttempt.conversationId === payload.conversationId
        && activeAttempt.messageId === payload.messageId) {
        messageAttempt.current = null;
        setDraft('');
        setSendError('');
      }
    };
    window.addEventListener('swamp-message-created', handleMessageCreated);
    return () => window.removeEventListener('swamp-message-created', handleMessageCreated);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const decryptMessages = async () => {
      if (!conversation || !messagesQuery.data || !keysQuery.data) {
        setDecryptedMessages([]);
        return;
      }
      try {
        const identity = await getLocalIdentityKey(walletAddress);
        const visible = await Promise.all(messagesQuery.data.map(async (message) => {
          try {
            const body = await decryptForConversation(
              message.body,
              conversation.id,
              message.senderAddress,
              walletAddress,
              identity,
              keysQuery.data ?? [],
            );
            return { ...message, body, decryptionFailed: false };
          } catch {
            return { ...message, body: 'Unable to decrypt this message with the available wallet key.', decryptionFailed: true };
          }
        }));
        if (!cancelled) setDecryptedMessages(visible);
      } catch {
        if (!cancelled) setDecryptedMessages([]);
      }
    };
    void decryptMessages();
    return () => { cancelled = true; };
  }, [conversation?.id, messagesQuery.data, keysQuery.data, walletAddress]);

  useEffect(() => {
    if (!conversation || !isActive || !pageVisible || messagesQuery.isLoading || messagesQuery.isError || keysQuery.isLoading || keysQuery.isError) return;
    const firstUnreadableIndex = decryptedMessages.findIndex((message) => message.decryptionFailed);
    const readableIndex = firstUnreadableIndex < 0 ? decryptedMessages.length - 1 : firstUnreadableIndex - 1;
    const readableMessage = readableIndex >= 0 ? decryptedMessages[readableIndex] : undefined;
    const latestLoadedMessage = messagesQuery.data?.[messagesQuery.data.length - 1];
    if (!readableMessage || readableMessage.id !== latestLoadedMessage?.id
      || lastMarkedMessageId.current === readableMessage.id
      || pendingReadMessageId.current === readableMessage.id) return;

    pendingReadMessageId.current = readableMessage.id;
    markConversationRead.mutate(
      { conversationId: conversation.id, data: { messageId: readableMessage.id } },
      {
        onSuccess: () => {
          lastMarkedMessageId.current = readableMessage.id;
          pendingReadMessageId.current = null;
          void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
        },
        onError: () => { pendingReadMessageId.current = null; },
      },
    );
  }, [
    conversation?.id,
    isActive,
    pageVisible,
    messagesQuery.data,
    messagesQuery.isLoading,
    messagesQuery.isError,
    keysQuery.isLoading,
    keysQuery.isError,
    decryptedMessages,
    markConversationRead.mutate,
    client,
    params,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!keysQuery.data) {
      setSafetyCode('');
      return () => { cancelled = true; };
    }
    void conversationSafetyCode(keysQuery.data).then((value) => {
      if (!cancelled) setSafetyCode(value);
    });
    return () => { cancelled = true; };
  }, [keysQuery.data]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!conversation || !draft.trim() || !keysQuery.data || missingMembers.length > 0 || sendMessage.isPending || encrypting) return;
    setSendError('');
    const body = draft.trim();
    const messageId = messageAttempt.current?.conversationId === conversation.id && messageAttempt.current.body === body
      ? messageAttempt.current.messageId
      : crypto.randomUUID();
    messageAttempt.current = { conversationId: conversation.id, body, messageId };
    setEncrypting(true);
    try {
      const identity = await getLocalIdentityKey(walletAddress);
      const encryptedBody = await encryptForConversation(body, conversation.id, walletAddress, identity, keysQuery.data);
      setDraft('');
      sendMessage.mutate({ conversationId: conversation.id, data: { messageId, senderAddress: walletAddress, body: encryptedBody } }, {
        onSuccess: () => {
          if (messageAttempt.current?.messageId === messageId) messageAttempt.current = null;
          client.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id, params) });
          client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
          void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
          void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
        },
        onError: (error) => {
          if (messageAttempt.current?.messageId !== messageId) return;
          setDraft(body);
          setSendError(errorMessage(error, 'Could not confirm delivery. Retrying this draft is safe.'));
        },
      });
    } catch (error) {
      setSendError(errorMessage(error, 'The message could not be encrypted on this device.'));
    } finally {
      setEncrypting(false);
    }
  };
  if (!conversation) return <div className="hidden min-w-0 flex-1 items-center justify-center p-8 md:flex"><div className="max-w-sm text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/.35)] text-[hsl(var(--foreground))]"><MessageCircle className="size-6" /></div><h2 className="mt-5 text-2xl font-semibold tracking-[-.05em]">Pick a conversation</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Your private lines live here. Start one with any XRPL address.</p></div></div>;
  return <section className="flex min-h-[520px] min-w-0 flex-1 flex-col bg-[hsl(var(--background)/.42)]" data-testid="message-pane">
     <div className="flex justify-end px-4 pt-2 md:px-7"><span className={`inline-flex items-center gap-1.5 text-[10px] ${realtimeStatus === 'live' ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`} role="status" data-testid="status-realtime"><span className={`size-1.5 rounded-full ${realtimeStatus === 'live' ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground))]'}`} />{realtimeStatus === 'live' ? 'Live updates connected' : 'Reconnecting to live updates'}</span></div>
     <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-4 md:px-7"><button onClick={onBack} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden" aria-label="Back to conversations" data-testid="button-back-conversations"><ArrowLeft className="size-4" /></button><div className="flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]">{conversation.type === 'group' ? <Hash className="size-4" /> : <AtSign className="size-4" />}</div><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-semibold">{conversation.title}</h2><button onClick={() => setShowSafetyCode(true)} className="flex items-center gap-1 text-[10px] text-[hsl(var(--primary))] hover:underline" data-testid="button-show-safety-code"><LockKeyhole className="size-3" /> end-to-end</button></div><p className="mono mt-0.5 truncate text-[10px] text-[hsl(var(--muted-foreground))]">{conversation.participantLabel} {conversation.memberCount > 1 ? `· ${conversation.memberCount} members` : ''}</p></div><button className="ml-auto rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Conversation options" data-testid="button-conversation-options"><MoreHorizontal className="size-5" /></button></div>
      <div className="soft-scrollbar flex flex-1 flex-col gap-4 overflow-auto px-4 py-6 md:px-10">{(messagesQuery.isLoading || keysQuery.isLoading) && [1, 2, 3].map((item) => <div key={item} className={`flex animate-pulse ${item % 2 ? 'justify-start' : 'justify-end'}`}><div className="h-14 w-44 rounded-2xl bg-[hsl(var(--muted))]" /></div>)}{(messagesQuery.isError || keysQuery.isError) && <div className="m-auto max-w-sm text-center text-sm text-[hsl(var(--muted-foreground))]" data-testid="status-messages-error"><CircleAlert className="mx-auto mb-3 size-5 text-[hsl(var(--destructive))]" />Messages or encryption keys could not be loaded. Refresh to try again.</div>}{!messagesQuery.isLoading && !messagesQuery.isError && messagesQuery.data?.length === 0 && <div className="m-auto max-w-sm text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"><LockKeyhole className="size-5" /></div><p className="mt-4 text-sm font-medium">This line is quiet.</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Send the first end-to-end encrypted message.</p></div>}{decryptedMessages.map((message) => <div key={message.id} className={`flex ${message.isMine ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.id}`}><div className={`max-w-[min(75%,520px)] ${message.isMine ? 'items-end' : 'items-start'} flex flex-col`}><div className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.isMine ? 'rounded-br-md bg-[hsl(var(--foreground))] text-[hsl(var(--card))]' : 'rounded-bl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}><p>{message.body}</p></div><div className="mono mt-1.5 flex items-center gap-2 px-1 text-[9px] text-[hsl(var(--muted-foreground))]"><span>{message.isMine ? 'you' : shortAddress(message.senderAddress)}</span><span>{formatClock(message.sentAt)}</span>{message.encrypted && <LockKeyhole className="size-2.5" />}{message.isMine && <span title={message.isRead ? 'Read' : 'Sent'} aria-label={message.isRead ? 'Read' : 'Sent'} data-testid={`message-delivery-status-${message.id}`}>{message.isRead ? <CheckCheck className="size-3 text-[hsl(var(--primary))]" /> : <Check className="size-3" />}</span>}</div></div></div>)}</div>
     <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.45)] p-4 md:px-7">{missingMembers.length > 0 && <p className="mb-3 rounded-lg border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] px-3 py-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="status-missing-member-keys">Encrypted sending is paused until every room member registers a device key. Missing: {missingMembers.map((member) => shortAddress(member.walletAddress)).join(', ')}.</p>}<form onSubmit={submit} className="relative"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(event as unknown as FormEvent); } }} rows={1} disabled={!keysQuery.data || missingMembers.length > 0 || sendMessage.isPending || encrypting} placeholder={missingMembers.length > 0 ? 'Waiting for room members to enable encryption…' : 'Write something unbothered…'} className="soft-scrollbar min-h-[52px] w-full resize-none rounded-2xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] py-4 pl-4 pr-14 text-sm outline-none transition placeholder:text-[hsl(var(--muted-foreground)/.7)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.13)] disabled:opacity-60" data-testid="input-message" /><button type="submit" disabled={!draft.trim() || sendMessage.isPending || encrypting || !keysQuery.data || missingMembers.length > 0} className="absolute bottom-2.5 right-2.5 flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Send encrypted message" data-testid="button-send-message">{sendMessage.isPending || encrypting ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />}</button></form>{sendError && <p className="mt-2 flex items-center gap-1 text-xs text-[hsl(var(--destructive))]" data-testid="text-send-error"><CircleAlert className="size-3" />{sendError}</p>}<p className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-[hsl(var(--muted-foreground))]"><ShieldCheck className="size-3 text-[hsl(var(--primary))]" /> Message content is encrypted on your device; verify the safety code with members.</p></div>
     {showSafetyCode && <Modal title="Encryption safety code" eyebrow="verify / out of band" onClose={() => setShowSafetyCode(false)}><p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">Compare this code with the other member using a separate trusted channel. Matching codes help detect a substituted public key. Until verified, a malicious server could replace keys.</p><div className="mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center"><p className="mono break-all text-lg font-semibold tracking-[.08em]" data-testid="text-encryption-safety-code">{safetyCode || 'Loading…'}</p></div><p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Encrypted key recovery backups are available in Settings; save one before changing devices. Frogtown’s custom encryption protocol has not been independently audited.</p></Modal>}
  </section>;
}

function ChatWorkspace({ onNewChat }: { onNewChat: () => void }) {
  const { walletAddress } = useWallet();
  const params = useMemo(() => ({ walletAddress }), [walletAddress]);
  const query = useListConversations(params, { query: { enabled: Boolean(walletAddress), queryKey: getListConversationsQueryKey(params), refetchInterval: 30000 } });
  const conversations = query.data ?? [];
  const [selectedId, setSelectedId] = useState(() => window.sessionStorage.getItem(`swamp-selected-conversation:${walletAddress}`) ?? '');
  const [mobileList, setMobileList] = useState(true);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const updateLayout = () => setIsDesktop(media.matches);
    updateLayout();
    media.addEventListener('change', updateLayout);
    return () => media.removeEventListener('change', updateLayout);
  }, []);
  useEffect(() => {
    const handleSelect = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      if (customEvent.detail) {
        setSelectedId(customEvent.detail);
        setMobileList(false);
        window.sessionStorage.setItem(`swamp-selected-conversation:${walletAddress}`, customEvent.detail);
      }
    };
    window.addEventListener('swamp-select-conversation', handleSelect);
    return () => window.removeEventListener('swamp-select-conversation', handleSelect);
  }, [walletAddress]);
  useEffect(() => {
    if (selectedId) window.sessionStorage.setItem(`swamp-selected-conversation:${walletAddress}`, selectedId);
  }, [selectedId, walletAddress]);
  const selected = conversations.find((conversation) => conversation.id === selectedId);
  const select = (id: string) => { setSelectedId(id); setMobileList(false); };
  return <div className="flex h-full min-h-0 flex-col md:flex-row">{(mobileList || !selectedId) && <ChatList conversations={conversations} selectedId={selectedId} onSelect={select} onNewChat={onNewChat} loading={query.isLoading} error={query.error} />}<MessagePane conversation={selected} isActive={isDesktop || !mobileList} onBack={() => setMobileList(true)} /></div>;
}

function GroupsPage({ onOpenGroup }: { onOpenGroup: (conversationId: string) => void }) {
  const { walletAddress } = useWallet();
  const client = useQueryClient();
  const params = useMemo(() => ({ walletAddress }), [walletAddress]);
  const groupsQuery = useListGroups(params, { query: { enabled: Boolean(walletAddress), queryKey: getListGroupsQueryKey(params), refetchInterval: 10000 } });
  const createGroup = useCreateGroup();
  const joinGroup = useJoinGroup();
  const [dialog, setDialog] = useState<'create' | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'success' } | null>(null);
  const groups = groupsQuery.data ?? [];
  const join = (groupId: string) => {
    joinGroup.mutate({ groupId, data: { walletAddress } }, { onSuccess: (group) => { client.invalidateQueries({ queryKey: getListGroupsQueryKey(params) }); setNotice({ message: `Joined ${group.name}.`, tone: 'success' }); }, onError: (error) => setNotice({ message: errorMessage(error, 'Could not join that group.'), tone: 'error' }) });
  };
  const submitGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    if (name.length < 2) return;
    createGroup.mutate({ data: { name, description, creatorAddress: walletAddress } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListGroupsQueryKey(params) }); setDialog(null); setNotice({ message: 'Your room is ready in Frogtown.', tone: 'success' }); }, onError: (error) => setNotice({ message: errorMessage(error, 'Could not create this group.'), tone: 'error' }) });
  };
  return <AppShell title="Community rooms" eyebrow="the $HERMIT community / find your people"><div className="mx-auto max-w-[1150px] p-5 md:p-8 lg:p-10"><div className="appear flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Users className="size-4 text-[hsl(var(--accent))]" /><span>XRPL community rooms</span></div><h2 className="mt-3 max-w-xl text-4xl font-semibold leading-[.95] tracking-[-.07em] md:text-6xl">Find your<br /><span className="text-[hsl(var(--primary))]">people.</span></h2><p className="mt-4 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">Public rooms for XRPL ideas, project updates, and conversations that bring the $HERMIT community closer together.</p></div><button onClick={() => setDialog('create')} className="flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))]" data-testid="button-create-group"><Plus className="size-4" /> Create a group</button></div><div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groupsQuery.isLoading && [1, 2, 3].map((item) => <div key={item} className="h-56 animate-pulse rounded-[1.25rem] bg-[hsl(var(--muted))]" />)}{groupsQuery.isError && <div className="col-span-full rounded-2xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] p-5 text-sm text-[hsl(var(--destructive))]" data-testid="status-groups-error">Groups are having a muddy moment. Refresh to try again.</div>}{!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && <div className="col-span-full rounded-[1.25rem] border border-dashed border-[hsl(var(--border))] p-10 text-center" data-testid="empty-groups"><div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/.4)]"><Users className="size-5" /></div><h3 className="mt-4 text-lg font-semibold">No rooms in the reeds yet.</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">Create the first group and give the community somewhere to land.</p></div>}{groups.map((group, index) => <article key={group.id} className={`lift appear rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 ${index % 3 === 1 ? 'appear-delay-1' : index % 3 === 2 ? 'appear-delay-2' : ''}`} data-testid={`card-group-${group.id}`}><div className="flex items-start justify-between"><div className={`flex size-11 items-center justify-center rounded-2xl ${index % 2 ? 'bg-[hsl(var(--accent)/.15)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]'}`}><Hash className="size-5" /></div><span className="mono rounded-full bg-[hsl(var(--muted))] px-2 py-1 text-[9px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">Public room</span></div><h3 className="mt-6 text-lg font-semibold tracking-[-.03em]">{group.name}</h3><p className="mt-2 min-h-10 text-sm leading-5 text-[hsl(var(--muted-foreground))]">{group.description || 'A public XRPL room.'}</p><div className="mt-6 flex items-center justify-between border-t border-[hsl(var(--border)/.75)] pt-4"><span className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><Users className="size-3.5" /> {group.memberCount} members</span>{group.isJoined ? <button onClick={() => onOpenGroup(group.conversationId)} className="flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] hover:underline" data-testid={`button-open-group-${group.id}`}>Open room <ArrowUpRight className="size-3.5" /></button> : <button onClick={() => join(group.id)} disabled={joinGroup.isPending} className="flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)] disabled:opacity-50" data-testid={`button-join-group-${group.id}`}>{joinGroup.isPending ? <RefreshCw className="size-3 animate-spin" /> : <DoorOpen className="size-3.5" />} Join</button>}</div></article>)}</div></div>{dialog === 'create' && <Modal title="Make a room" eyebrow="public / community-owned" onClose={() => setDialog(null)}><form onSubmit={submitGroup} className="space-y-5"><div><label htmlFor="group-name" className="mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Group name</label><input id="group-name" name="name" required minLength={2} placeholder="e.g. Ledger After Dark" className="mt-2 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-group-name" /></div><div><label htmlFor="group-description" className="mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">What happens here?</label><textarea id="group-description" name="description" rows={3} placeholder="Set the room's signal in one line." className="mt-2 w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-group-description" /></div><button disabled={createGroup.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))] disabled:opacity-50" data-testid="button-submit-group">{createGroup.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4 text-[hsl(var(--secondary))]" />} {createGroup.isPending ? 'Making room…' : 'Create group'}</button></form></Modal>}{notice && <Notice message={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}</AppShell>;
}

function SettingsPage() {
  const { walletAddress, disconnect } = useWallet();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 15000 } });
  const [copied, setCopied] = useState(false);
  const [privateMode, setPrivateMode] = useState(true);
  const copy = () => { navigator.clipboard?.writeText(walletAddress); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  return <AppShell title="Settings" eyebrow="your identity / your rules"><div className="mx-auto max-w-[900px] p-5 md:p-8 lg:p-10"><div className="appear"><p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">wallet identity</p><h2 className="mt-3 text-4xl font-semibold tracking-[-.07em] md:text-5xl">Keep it yours.</h2><p className="mt-4 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">Frogtown does not create a separate profile for you. Your XRPL wallet address is your name here.</p></div><div className="mt-10 grid gap-5 md:grid-cols-[1.2fr_.8fr]"><section className="rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">connected wallet</p><div className="mt-4 flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/.45)]"><WalletCards className="size-5" /></div><div><p className="font-semibold" data-testid="text-settings-username">{shortAddress(walletAddress)}</p><p className="mono mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">XRPL mainnet</p></div></div></div><span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary)/.1)] px-2.5 py-1.5 text-[10px] font-medium text-[hsl(var(--primary))]" data-testid="status-wallet-connected"><span className="size-1.5 rounded-full bg-[hsl(var(--primary))]" /> Connected</span></div><div className="mt-7 flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-3"><p className="mono min-w-0 flex-1 truncate text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-full-wallet-address">{walletAddress}</p><button onClick={copy} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" aria-label="Copy wallet address" data-testid="button-copy-address">{copied ? <Check className="size-4 text-[hsl(var(--primary))]" /> : <Copy className="size-4" />}</button></div><button onClick={disconnect} className="mt-6 flex items-center gap-2 text-xs text-[hsl(var(--destructive))] hover:underline" data-testid="button-settings-disconnect"><LogOut className="size-3.5" /> Disconnect this wallet</button></section><section className="rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6"><p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">connection health</p><div className="mt-5 flex items-center gap-3"><div className={`flex size-10 items-center justify-center rounded-xl ${health.isError ? 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]'}`}><Wifi className="size-4" /></div><div><p className="text-sm font-medium">{health.isLoading ? 'Checking signal…' : health.isError ? 'Signal interrupted' : 'All systems listening'}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid="status-api-health">{health.isError ? 'The server did not answer.' : health.data?.status ?? 'XRPL relay ready'}</p></div></div><div className="mt-5 h-px bg-[hsl(var(--border))]" /><div className="mt-5 flex items-start gap-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[hsl(var(--primary))]" /><p>Wallet sessions expire quickly. Messages remain address-to-address.</p></div></section></div><section className="mt-5 rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6"><div className="flex items-start gap-4"><div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]"><Bell className="size-4" /></div><div className="flex-1"><h3 className="font-semibold">Privacy controls</h3><p className="mt-1 max-w-xl text-sm leading-5 text-[hsl(var(--muted-foreground))]">Keep your presence quiet until you choose to speak. We never infer a public profile from your address.</p><div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4"><div><p className="text-sm font-medium">Private by default</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Only your messages reveal you are here.</p></div><button onClick={() => setPrivateMode((value) => !value)} className={`relative h-7 w-12 rounded-full transition ${privateMode ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground)/.28)]'}`} role="switch" aria-checked={privateMode} aria-label="Toggle private by default" data-testid="switch-private-mode"><span className={`absolute top-1 size-5 rounded-full bg-[hsl(var(--card))] shadow-sm transition-transform ${privateMode ? 'translate-x-6' : 'translate-x-1'}`} /></button></div></div></div></section><BrowserNotificationSettings walletAddress={walletAddress} /><div className="mt-8 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><KeyRound className="size-3.5 text-[hsl(var(--secondary-foreground))]" /> Frogtown uses your wallet as your handle. Nothing else is required.</div></div></AppShell>;
}

function LockedPage({ title }: { title: string }) {
  const [location, setLocation] = useLocation();
  return <div className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-6"><div className="max-w-md text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] shadow-[4px_4px_0_hsl(var(--accent))]"><LockKeyhole className="size-6" /></div><p className="mono mt-7 text-[10px] uppercase tracking-[.2em] text-[hsl(var(--muted-foreground))]">wallet required</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.07em]">{title} starts at the door.</h1><p className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Connect with Xaman to enter Frogtown, the wallet-connected home for $HERMIT and the XRPL community.</p><button onClick={() => setLocation('/')} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-5 py-3 text-sm font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]">Connect wallet <ArrowRight className="size-4" /></button><p className="mono mt-5 text-[10px] text-[hsl(var(--muted-foreground))]">{location}</p></div></div>;
}

function HomePage() {
  const { walletAddress } = useWallet();
  const [dialog, setDialog] = useState(false);
  if (!walletAddress) return <WalletEntry />;
  return <AppShell title="Chats" eyebrow="private lines / wallet-native" onNewChat={() => setDialog(true)}><ChatWorkspace onNewChat={() => setDialog(true)} />{dialog && <DirectChatDialog onClose={() => setDialog(false)} onCreated={(id) => { setDialog(false); window.sessionStorage.setItem('swamp-selected-conversation', id); window.dispatchEvent(new CustomEvent('swamp-select-conversation', { detail: id })); }} />}</AppShell>;
}

function RouterView() {
  const { walletAddress } = useWallet();
  const [location, setLocation] = useLocation();
  useEffect(() => {
    if (!walletAddress && location !== '/') {
      window.sessionStorage.setItem('frogtown-signin-return-to', location);
    }
  }, [location, walletAddress]);
  if (!walletAddress && location !== '/') return <LockedPage title={location === '/groups' ? 'Group discovery' : location === '/timeline' ? 'Community timeline' : location === '/quests' ? 'Daily quests' : 'Settings'} />;
  return <Switch><Route path="/" component={() => <HomePage />} /><Route path="/groups" component={() => <GroupsPage onOpenGroup={(id) => { window.sessionStorage.setItem(`swamp-selected-conversation:${walletAddress}`, id); setLocation('/'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('swamp-select-conversation', { detail: id })), 0); }} />} /><Route path="/timeline" component={() => <TimelineRoute />} /><Route path="/quests" component={() => <DailyQuestsRoute />} /><Route path="/settings/recovery" component={() => <EncryptionRecoveryRoute />} /><Route path="/settings" component={SettingsPage} /><Route component={() => <HomePage />} /></Switch>;
}

function TimelineRoute() {
  const { walletAddress } = useWallet();
  return <AppShell title="Timeline" eyebrow="public / community"><TimelinePage walletAddress={walletAddress} /></AppShell>;
}

function DailyQuestsRoute() {
  const { walletAddress } = useWallet();
  return <AppShell title="Daily quests" eyebrow="points / community"><DailyQuestsPage walletAddress={walletAddress} /></AppShell>;
}

function EncryptionRecoveryRoute() {
  const { walletAddress } = useWallet();
  return (
    <AppShell title="Chat recovery" eyebrow="encrypted keys / device transfer">
      <div className="mx-auto max-w-[900px] space-y-5 p-5 md:p-8 lg:p-10">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">device security</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-.07em]">Keep your key close.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">Create an encrypted backup before changing browsers or devices. The recovery passphrase is never sent to Frogtown.</p>
        </div>
        <EncryptionRecoveryPanel walletAddress={walletAddress} />
      </div>
    </AppShell>
  );
}

function KeyBootstrapGate({ children }: { children: ReactNode }) {
  const { walletAddress, disconnect } = useWallet();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!walletAddress) {
      setStatus('idle');
      setError('');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError('');
    void ensureIdentityKey(walletAddress).then(() => {
      if (!cancelled) setStatus('ready');
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(errorMessage(cause, 'Could not initialize this device’s encryption key.'));
        setStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [walletAddress, attempt]);

  if (!walletAddress || status === 'ready') return <>{children}</>;
  return (
    <div className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-4">
      <section className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.95)] p-5 shadow-xl sm:p-7">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"><LockKeyhole className="size-5" /></div>
        <p className="mono mt-6 text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">device encryption setup</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.06em]">{status === 'error' ? 'Encryption needs attention.' : 'Preparing your private key.'}</h1>
        {status === 'loading'
          ? <p className="mt-3 flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"><RefreshCw className="size-4 animate-spin" /> Creating or checking this device’s encryption key…</p>
          : <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]" data-testid="status-encryption-bootstrap-error">{error}</p>}
        <p className="mt-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your private key stays in this browser and is never sent to Frogtown. Restore an encrypted backup to access chats on this device. Keep the recovery file and passphrase safe.</p>
        {status === 'error' && (
          <>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setAttempt((value) => value + 1)} className="rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]" data-testid="button-retry-encryption-setup">Try again</button>
              <button onClick={disconnect} className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-medium hover:bg-[hsl(var(--muted))]" data-testid="button-disconnect-encryption-setup">Disconnect</button>
            </div>
            <div className="mt-5">
              <EncryptionRecoveryPanel
                walletAddress={walletAddress}
                restoreOnly
                onRestored={() => { setStatus('loading'); setAttempt((value) => value + 1); }}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AuthGate() {
  const storedAddress = window.localStorage.getItem('swamp-wallet-address') ?? '';
  const [walletAddress, setWalletAddressState] = useState(storedAddress);
  const [authReady, setAuthReady] = useState(!storedAddress);
  const walletQuery = useGetCurrentWallet({
    query: {
      enabled: Boolean(storedAddress),
      queryKey: getGetCurrentWalletQueryKey(),
      retry: false,
      staleTime: 30_000,
    },
  });
  const logoutWallet = useLogoutWallet();

  useEffect(() => {
    if (!storedAddress) {
      setAuthReady(true);
      return;
    }
    if (walletQuery.isSuccess) {
      setWalletAddressState(walletQuery.data.walletAddress);
      window.localStorage.setItem('swamp-wallet-address', walletQuery.data.walletAddress);
      setAuthReady(true);
      return;
    }
    if (walletQuery.isError) {
      const status = (walletQuery.error as { status?: number } | undefined)?.status;
      if (status === 401) {
        setWalletAddressState('');
        window.localStorage.removeItem('swamp-wallet-address');
      }
      setAuthReady(true);
    }
  }, [storedAddress, walletQuery.data, walletQuery.error, walletQuery.isError, walletQuery.isSuccess]);

  const setWalletAddress = (address: string) => {
    setWalletAddressState(address);
    window.localStorage.setItem('swamp-wallet-address', address);
  };
  const disconnect = () => {
    logoutWallet.mutate(undefined, { onSettled: () => queryClient.clear() });
    setWalletAddressState('');
    window.localStorage.removeItem('swamp-wallet-address');
    setAuthReady(true);
  };

  if (!authReady) {
    return <div className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-6"><div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-5 py-4 text-sm text-[hsl(var(--muted-foreground))] shadow-lg"><RefreshCw className="size-4 animate-spin text-[hsl(var(--primary))]" /> Checking wallet session…</div></div>;
  }

  return <WalletContext.Provider value={{ walletAddress, setWalletAddress, disconnect }}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ErrorBoundary resetKey={window.location.pathname}><KeyBootstrapGate><RealtimeBridge><RouterView /></RealtimeBridge></KeyBootstrapGate></ErrorBoundary></WouterRouter></WalletContext.Provider>;
}

function App() {
  return <QueryClientProvider client={queryClient}><AuthGate /></QueryClientProvider>;
}

export default App;