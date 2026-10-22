import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode, type FormEvent } from 'react';
import { MobileAuthApprovalGate } from './components/mobile-auth-approval';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Ban,
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
  Smartphone,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Trash2,
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
  getGetWalletProfileQueryKey,
  getGetGamificationLeaderboardQueryKey,
  getGetGamificationSummaryQueryKey,
  getHealthCheckQueryKey,
  getListConversationMessagesQueryKey,
  getListConversationHistoryShareWorkQueryKey,
  getListConversationHistorySharesQueryKey,
  getListBlockedWalletsQueryKey,
  getListConversationsQueryKey,
  getListGroupsQueryKey,
  useCreateDirectConversation,
  useAcceptConversationRequest,
  useBlockWallet,
  useCreateConversationHistoryShare,
  useCreateGroup,
  useCreateGroupInvite,
  useDeleteGroup,
  useDeleteGroupMessage,
  previewGroupInvite,
  useCreateWalletSession,
  useGetConversationEncryptionKeys,
  useGetCurrentWallet,
  useGetWalletProfile,
  useGetWalletSession,
  useHealthCheck,
  useJoinGroup,
  useListRemovedGroupMembers,
  useRemoveGroupMember,
  useRevokeGroupInvite,
  useRestoreGroupMember,
  joinGroupByInvite,
  useListConversationMessages,
  useListConversationHistoryShareWork,
  useListConversationHistoryShares,
  useListBlockedWallets,
  useListConversations,
  useListGroups,
  useMarkConversationRead,
  useLogoutWallet,
  useDeclineConversationRequest,
  useSendMessage,
  useUnblockWallet,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { BrowserNotificationSettings } from '@/components/browser-notification-settings';
import { EncryptionRecoveryPanel } from '@/components/encryption-recovery';
import { TimelinePage } from '@/components/timeline-page';
import { DailyQuestsPage } from '@/components/daily-quests-page';
import { HermitMarketTicker } from '@/components/hermit-market-ticker';
import { HermitTick } from '@/components/hermit-tick';
import { LadyChainConnect } from '@/components/ladychain-connect';
import { LadyChainSessionSync } from '@/components/ladychain-session-sync';
import { ThemeToggle } from '@/components/theme-toggle';
import { UsernameOnboardingGate } from '@/components/username-onboarding-gate';
import { UsernameSettingsCard } from '@/components/username-settings-card';
import { notifyIncomingMessage } from '@/lib/browser-notifications';
import {
  findPendingEncryptedMessage,
  removePendingEncryptedMessage,
  savePendingEncryptedMessage,
  clearPendingEncryptedMessages,
  removePendingForConversation,
  type PendingEncryptedMessage,
} from '@/lib/message-outbox';
import {
  conversationSafetyCode,
  decryptForConversation,
  encryptForConversation,
  ensureIdentityKey,
  IdentityKeyRecoveryRequiredError,
  getConversationKeyChanges,
  getLocalIdentityKey,
  resetIdentityKey,
  trustConversationKeyChange,
  getEncryptedMessageRecipients,
  type ConversationKeyChange,
  type ConversationPublicKey,
} from '@/lib/e2ee';

const queryClient = new QueryClient();
const WALLET_ENCRYPTION_RESET_EVENT = 'frogtown:wallet-encryption-reset';
const ENCRYPTION_KEY_CHECK_EVENT = 'frogtown:check-encryption-key';
const ENCRYPTION_RESET_CHANNEL = 'frogtown:encryption-reset';
const ENCRYPTION_RESET_STORAGE_KEY = 'frogtown:encryption-reset-notice';
const BACKUP_CREATED_EVENT = 'frogtown:encrypted-backup-created';

const freshStartBackupKey = (walletAddress: string) =>
  `frogtown:fresh-start-backup:${walletAddress}`;

function broadcastEncryptionReset(walletAddress: string) {
  const notice = { walletAddress, createdAt: Date.now() };
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(ENCRYPTION_RESET_CHANNEL);
      channel.postMessage(notice);
      channel.close();
      return;
    } catch {
      // Use the storage-event fallback when BroadcastChannel is unavailable.
    }
  }
  try {
    window.localStorage.setItem(ENCRYPTION_RESET_STORAGE_KEY, JSON.stringify(notice));
    window.localStorage.removeItem(ENCRYPTION_RESET_STORAGE_KEY);
  } catch {
    // Other tabs will still be checked when they reconnect or become visible.
  }
}

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
    const openConversation = (conversationId: string) => {
      if (!conversationId) return;
      try {
        window.sessionStorage.setItem(`swamp-selected-conversation:${walletAddress}`, conversationId);
      } catch {
        // The inbox remains available if this browser blocks tab storage.
      }
      setLocation('/');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('swamp-select-conversation', { detail: conversationId }));
      }, 0);
    };
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'frogtown:open-conversation' && typeof event.data.conversationId === 'string') {
        openConversation(event.data.conversationId);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    const requestedConversation = new URL(window.location.href).searchParams.get('conversation');
    if (requestedConversation) openConversation(requestedConversation);
    return () => navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
  }, [walletAddress, setLocation]);

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
            && (
              path.endsWith('/messages')
              || path.endsWith('/keys')
              || path.endsWith('/history-shares')
              || path.endsWith('/history-share-work')
            );
        },
      });
    };

    let hasConnected = false;
    source.onopen = () => {
      const reconnected = hasConnected;
      hasConnected = true;
      setStatus('live');
      refreshConversationData();
      if (reconnected) {
        window.dispatchEvent(new CustomEvent(ENCRYPTION_KEY_CHECK_EVENT));
      }
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          walletAddress?: string;
          conversationId?: string;
          groupId?: string;
          messageId?: string;
          senderAddress?: string;
          isRequest?: boolean;
          removedWalletAddress?: string;
        };
        if (payload.type === 'wallet.encryption.reset') {
          if (payload.walletAddress === walletAddress) {
            window.dispatchEvent(new CustomEvent(WALLET_ENCRYPTION_RESET_EVENT, {
              detail: { walletAddress: payload.walletAddress, source: 'server' },
            }));
          }
          return;
        }
        if (payload.type === 'group.member-removed' && payload.conversationId) {
          void client.invalidateQueries({ queryKey: getListGroupsQueryKey({ walletAddress }) });
          void client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
          if (payload.removedWalletAddress === walletAddress) {
            void client.removeQueries({
              queryKey: getListConversationMessagesQueryKey(payload.conversationId, { walletAddress }),
            });
            void client.removeQueries({
              queryKey: getListConversationHistorySharesQueryKey(payload.conversationId),
            });
            void client.removeQueries({
              queryKey: getListConversationHistoryShareWorkQueryKey(payload.conversationId),
            });
            try {
              removePendingForConversation(walletAddress, payload.conversationId);
            } catch {
              // A malformed local retry record must not prevent access revocation.
            }
            const selectedConversation = window.sessionStorage.getItem(`swamp-selected-conversation:${walletAddress}`);
            if (selectedConversation === payload.conversationId) {
              window.sessionStorage.removeItem(`swamp-selected-conversation:${walletAddress}`);
              setLocation('/groups');
            }
            window.dispatchEvent(new CustomEvent('swamp-group-member-removed', { detail: payload }));
          }
          return;
        }
        if (!payload.conversationId) return;
        if (payload.type === 'conversation.deleted') {
          refreshConversationData();
          void client.invalidateQueries({ queryKey: getListGroupsQueryKey({ walletAddress }) });
          const selectedConversation = window.sessionStorage.getItem(`swamp-selected-conversation:${walletAddress}`);
          if (selectedConversation === payload.conversationId) {
            window.sessionStorage.removeItem(`swamp-selected-conversation:${walletAddress}`);
            setLocation('/groups');
          }
          return;
        }
        if (payload.type === 'conversation.updated') {
          refreshConversationData();
          return;
        }
        if (payload.type === 'message.created') {
          void client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
          void client.invalidateQueries({
            queryKey: getListConversationMessagesQueryKey(payload.conversationId, { walletAddress }),
          });
          window.dispatchEvent(new CustomEvent('swamp-message-created', { detail: payload }));
          if (!payload.isRequest && payload.senderAddress && payload.senderAddress !== walletAddress && payload.messageId) {
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
      if (document.visibilityState === 'visible') {
        refreshConversationData();
        window.dispatchEvent(new CustomEvent(ENCRYPTION_KEY_CHECK_EVENT));
      }
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

type DecryptedChatMessage = {
  id: string;
  conversationId: string;
  senderAddress: string;
  senderUsername: string | null;
  body: string;
  sentAt: string;
  isMine: boolean;
  encrypted: boolean;
  isRead: boolean;
  decryptionFailed: boolean;
  historyPending: boolean;
  historyShared: boolean;
  historySharedByAddress: string | null;
  recipientAddresses: string[];
};

function ChatMessageItem({
  message,
  isGroup,
  canDelete,
  onDelete,
}: {
  message: DecryptedChatMessage;
  isGroup: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className={`flex ${message.isMine ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.id}`}>
      <div className={`flex max-w-[min(75%,520px)] flex-col ${message.isMine ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-[0_2px_7px_rgba(25,55,34,.06)] ${message.isMine ? 'rounded-br-md bg-[hsl(var(--foreground))] text-[hsl(var(--card))]' : 'rounded-bl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}>
          <p>{message.body}</p>
        </div>
        <div className="mono mt-1.5 flex flex-wrap items-center gap-2 px-1 text-[9px] text-[hsl(var(--muted-foreground))]">
          <span className="inline-flex items-center gap-1">
            {message.isMine ? (
              <>
                you
                {message.senderUsername && <span className="text-[hsl(var(--foreground))]">@{message.senderUsername}</span>}
              </>
            ) : (
              <>
                {message.senderUsername ? (
                  <>
                    <span className="text-[hsl(var(--foreground))]">@{message.senderUsername}</span>
                    <span title={message.senderAddress}>{shortAddress(message.senderAddress)}</span>
                  </>
                ) : shortAddress(message.senderAddress)}
                <HermitTick walletAddress={message.senderAddress} className="size-3.5" />
              </>
            )}
          </span>
          <span>{formatClock(message.sentAt)}</span>
          {message.encrypted && <LockKeyhole className="size-2.5" />}
          {message.isMine && (
            <span title={message.isRead ? 'Read' : 'Sent'} aria-label={message.isRead ? 'Read' : 'Sent'} data-testid={`message-delivery-status-${message.id}`}>
              {message.isRead ? <CheckCheck className="size-3 text-[hsl(var(--primary))]" /> : <Check className="size-3" />}
            </span>
          )}
          {message.historyShared && (
            <span className="rounded-full bg-[hsl(var(--primary)/.1)] px-2 py-0.5 text-[hsl(var(--primary))]" data-testid={`message-history-shared-${message.id}`} title={`Shared by ${message.historySharedByAddress ?? 'a room member'}`}>
              history shared with you
            </span>
          )}
          {message.historyPending && (
            <span className="rounded-full bg-[hsl(var(--accent)/.12)] px-2 py-0.5 text-[hsl(var(--muted-foreground))]" data-testid={`message-history-pending-${message.id}`}>
              waiting for history share
            </span>
          )}
          {isGroup && canDelete && (
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]" aria-label="Delete group message" title="Delete this group message">
              <Trash2 className="size-3" /> Delete
            </button>
          )}
          {isGroup && message.recipientAddresses.length > 0 && !message.historyShared && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full bg-[hsl(var(--muted)/.7)] px-2 py-0.5 hover:bg-[hsl(var(--muted))]" aria-label={`Show ${message.recipientAddresses.length} encrypted message recipients`} data-testid={`message-recipients-${message.id}`}>
                to {message.recipientAddresses.length} wallet{message.recipientAddresses.length === 1 ? '' : 's'}
              </summary>
              <div className="absolute bottom-full left-0 z-20 mb-1 min-w-48 max-w-72 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-[10px] shadow-lg" role="note">
                <p className="mb-2 font-semibold">Encrypted for these wallets</p>
                <ul className="space-y-1">{message.recipientAddresses.map((address) => <li key={address} className="mono">{shortAddress(address)}</li>)}</ul>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
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

const mascotImageUrl = `${import.meta.env.BASE_URL}images/hermit-mascot.jpg`;

function FrogtownMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? '' : 'select-none'}`}>
      <div className="relative size-9 rounded-xl shadow-[3px_3px_0_hsl(var(--accent))]">
        <img src={mascotImageUrl} alt="" className="size-9 rounded-xl object-cover ring-1 ring-white/20" />
        <span className="absolute -bottom-1 -right-1 size-2 rounded-full bg-[hsl(var(--sidebar-accent))]" />
      </div>
      {!compact && <span className="text-lg font-bold tracking-[-.04em] text-[hsl(var(--sidebar-foreground))]">Frogtown</span>}
    </div>
  );
}

function WalletPill({ address, onClick }: { address: string; onClick?: () => void }) {
  const profileQueryKey = [...getGetWalletProfileQueryKey(), address];
  const profileQuery = useGetWalletProfile({
    query: {
      queryKey: profileQueryKey,
      staleTime: 60_000,
    },
    request: { credentials: 'same-origin' },
  });
  const body = (
    <>
      <span className="relative flex size-7 items-center justify-center rounded-lg bg-[hsl(var(--sidebar-accent)/.18)] text-[hsl(var(--sidebar-accent))]">
        <span className="size-2 rounded-full bg-[hsl(var(--sidebar-accent))] pulse-dot" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-[9px] uppercase tracking-[.17em] text-[hsl(var(--sidebar-foreground)/.52)]" data-testid="text-sidebar-username">
          {profileQuery.data?.username ? `@${profileQuery.data.username}` : 'wallet identity'}
        </span>
        <span className="flex min-w-0 items-center gap-1.5"><span className="mono block min-w-0 truncate text-xs text-[hsl(var(--sidebar-foreground))]" data-testid="text-sidebar-wallet">{shortAddress(address)}</span><HermitTick walletAddress={address} currentWallet className="size-4" /></span>
      </span>
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

function Header({ title, eyebrow, onMenu, walletAddress }: { title: string; eyebrow: string; onMenu: () => void; walletAddress?: string }) {
  return (
    <header className="flex min-h-[76px] items-center justify-between border-b border-[hsl(var(--border)/.75)] px-5 py-4 md:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden" aria-label="Open navigation" data-testid="button-open-navigation"><Menu className="size-5" /></button>
        <div>
          <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-[-.04em] md:text-2xl" data-testid="text-page-title">{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <HermitMarketTicker walletAddress={walletAddress} />
        <ThemeToggle />
        <span className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] sm:flex"><span className="size-1.5 rounded-full bg-[hsl(var(--primary))] pulse-dot" /> XRPL mainnet</span>
      </div>
    </header>
  );
}

function AppShell({ children, title, eyebrow, onNewChat }: { children: ReactNode; title: string; eyebrow: string; onNewChat?: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { walletAddress } = useWallet();
  const startChat = onNewChat ?? (() => setLocation('/'));
  return (
    <div className="swamp-app noise flex min-h-[100dvh] overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} onNewChat={startChat} />
      {mobileOpen && <button className="fixed inset-0 z-20 bg-[hsl(var(--foreground)/.32)] md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-navigation-overlay" />}
      <main className="flex min-w-0 flex-1 flex-col">
        <Header title={title} eyebrow={eyebrow} onMenu={() => setMobileOpen(true)} walletAddress={walletAddress} />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

function XrpNetworkMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M5 7c4 0 4.6 6 11 6s7-6 11-6M5 25c4 0 4.6-6 11-6s7 6 11 6" />
    </svg>
  );
}

function WalletEntry() {
  const { setWalletAddress } = useWallet();
  const [, setLocation] = useLocation();
  const createSession = useCreateWalletSession();
  const [session, setSession] = useState<{ sessionId: string; qrUrl: string; deeplink: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'info' | 'success' } | null>(() => {
    try {
      const message = window.sessionStorage.getItem('frogtown-ladychain-sync-error');
      if (!message) return null;
      window.sessionStorage.removeItem('frogtown-ladychain-sync-error');
      return { message: `Wallet session ended: ${message}`, tone: 'error' };
    } catch {
      return null;
    }
  });
  const statusQuery = useGetWalletSession(session?.sessionId ?? '', {
    query: {
      enabled: Boolean(session?.sessionId),
      queryKey: getGetWalletSessionQueryKey(session?.sessionId ?? ''),
      refetchInterval: 1500,
    },
  });
  const status = statusQuery.data;
  const finishSignIn = useCallback((walletAddress: string) => {
    const requestedPath = window.sessionStorage.getItem('frogtown-signin-return-to');
    window.sessionStorage.removeItem('frogtown-signin-return-to');
    const destination = requestedPath && ['/', '/groups', '/timeline', '/settings', '/settings/recovery'].includes(requestedPath)
      ? requestedPath
      : '/';
    setWalletAddress(walletAddress);
    setLocation(destination);
    setNotice({ message: 'Wallet connected. Welcome to Frogtown.', tone: 'success' });
    setSession(null);
  }, [setLocation, setWalletAddress]);

  useEffect(() => {
    if (status?.status === 'connected' && status.walletAddress) {
      finishSignIn(status.walletAddress);
    }
    if (status?.status === 'expired') {
      setNotice({ message: 'That Xaman session expired. Start a fresh sign-in.', tone: 'error' });
      setSession(null);
    }
  }, [finishSignIn, status?.status, status?.walletAddress]);

  const connect = () => {
    setNotice(null);
    createSession.mutate(undefined, {
      onSuccess: (created) => setSession(created),
      onError: (error) => setNotice({ message: errorMessage(error, 'Xaman could not open a session right now.'), tone: 'error' }),
    });
  };

  return (
    <div className="ft-entry">
      <div className="ft-entry-shell">
        <section className="ft-entry-scene" aria-labelledby="frogtown-welcome-title">
          <header className="ft-entry-header">
            <FrogtownMark />
            <span className="ft-entry-network"><span className="ft-entry-network-dot" /> XRPL / LADYCHAIN</span>
          </header>
          <div className="ft-entry-intro">
            <p className="ft-entry-kicker"><span /> $HERMIT community / XRPL + LADYCHAIN</p>
            <h1 id="frogtown-welcome-title">Good people.<br /><span>Good signals.</span></h1>
            <p className="ft-entry-lede">A little more human side of the ledger. Find your people, settle into a room, and make yourself at home.</p>
            <div className="ft-entry-spaces" aria-label="Frogtown spaces">
              <span>Private chats</span><span>Community rooms</span><span>Public timeline</span>
            </div>
            <div className="ft-entry-social-links" aria-label="Frogtown community links">
              <a
                className="ft-entry-social-link"
                href="https://t.me/hermitthefrogxrp"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join Frogtown on Telegram"
              >
                <Send aria-hidden="true" />
                <span>Join Telegram</span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <a
                className="ft-entry-social-link"
                href="https://x.com/hermitthefrogxrp"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow Frogtown on X"
              >
                <span className="ft-entry-social-x" aria-hidden="true">𝕏</span>
                <span>Follow on X</span>
                <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <div className="ft-entry-download-links" aria-label="Frogtown app downloads">
              <button
                className="ft-entry-download-button"
                type="button"
                disabled
                aria-label="Frogtown for Android — coming soon"
              >
                <Smartphone aria-hidden="true" />
                <span><strong>Android app</strong><small>Coming soon</small></span>
              </button>
              <button
                className="ft-entry-download-button"
                type="button"
                disabled
                aria-label="Frogtown for iOS — coming soon"
              >
                <Smartphone aria-hidden="true" />
                <span><strong>iOS app</strong><small>Coming soon</small></span>
              </button>
            </div>
          </div>

          <div className="ft-entry-art" aria-label="An illustrative private conversation in Frogtown">
            <div className="ft-entry-orbit ft-entry-orbit-one" />
            <div className="ft-entry-orbit ft-entry-orbit-two" />
            <div className="ft-entry-xrp-network" aria-hidden="true">
              <svg className="ft-entry-xrp-lines" viewBox="0 0 500 360" preserveAspectRatio="none">
                <path d="M30 65 210 14 395 65 460 104M30 65 30 234M30 234Q245 308 460 104" />
                <circle cx="30" cy="65" r="2.5" />
                <circle cx="210" cy="14" r="2.5" />
                <circle cx="395" cy="65" r="2.5" />
                <circle cx="460" cy="104" r="2.5" />
                <circle cx="30" cy="234" r="2.5" />
              </svg>
              <span className="ft-entry-xrp-node ft-xrp-node-a"><XrpNetworkMark /><b>XRP</b></span>
              <span className="ft-entry-xrp-node ft-xrp-node-b"><XrpNetworkMark /><b>XRP</b></span>
              <span className="ft-entry-xrp-node ft-xrp-node-c"><XrpNetworkMark /><b>XRP</b></span>
              <span className="ft-entry-xrp-node ft-xrp-node-d"><XrpNetworkMark /><b>XRP</b></span>
              <span className="ft-entry-xrp-node ft-xrp-node-e"><XrpNetworkMark /><b>XRP</b></span>
            </div>
            <div className="ft-entry-mascot-wrap">
              <div className="ft-entry-mascot-glow" />
              <img className="ft-entry-mascot" src={mascotImageUrl} alt="$HERMIT frog mascot wearing a red hood" />
              <span className="ft-entry-mascot-sticker">one ledger<br />many voices</span>
            </div>
            <div className="ft-entry-bubble ft-entry-bubble-top"><span /> Room for your kind of weird.</div>
            <div className="ft-entry-bubble ft-entry-bubble-bottom">Your wallet is your hello <b aria-hidden="true">↗</b></div>
            <div className="ft-entry-phone">
              <div className="ft-entry-phone-status" aria-hidden="true"><span>9:41</span><span>XRPL <i /></span></div>
              <div className="ft-entry-phone-head">
                <div className="ft-entry-avatar">M</div>
                <div><strong>Mara + you</strong><span>illustrative private chat</span></div>
                <LockKeyhole className="ft-entry-phone-lock" aria-label="End-to-end encrypted" />
              </div>
              <div className="ft-entry-phone-messages">
                <p className="ft-entry-message received">Found a tiny XRPL art room that feels like a porch.</p>
                <p className="ft-entry-message sent">That is exactly the kind of corner I came here for.</p>
                <p className="ft-entry-message received">I’ll save you a seat. Just bring your wallet.</p>
              </div>
              <div className="ft-entry-phone-foot"><span /> Example · encrypted on-device</div>
              <div className="ft-entry-phone-homebar" aria-hidden="true" />
            </div>
          </div>
          <footer className="ft-entry-scene-foot">
            <span>Built for XRPL and LadyChain.</span>
            <span className="ft-entry-asterisk" aria-hidden="true">*</span>
          </footer>
        </section>

        <section className="ft-entry-access" aria-labelledby="frogtown-entry-title">
          <div className="ft-entry-access-top flex-wrap gap-3">
            <span className="ft-entry-overline">YOUR FRONT DOOR</span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
              <HermitMarketTicker />
              <ThemeToggle />
              <a className="ft-entry-help-link" href="#frogtown-entry-promises">How it works <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <div className="ft-entry-access-body">
            <div className="ft-entry-welcome"><span /> Welcome in</div>
            <h2 id="frogtown-entry-title">Your people<br />are <span>around here.</span></h2>
            <p className="ft-entry-access-copy">Connect with Xaman on XRPL or an EVM wallet on LadyChain. $HERMIT ownership is not required — your wallet address is your Frogtown identity.</p>
            {!session ? (
              <div className="ft-entry-connect-card">
                <div className="ft-entry-connect-intro">
                  <div className="ft-entry-wallet-icon"><WalletCards className="size-5" /></div>
                  <div><strong>Connect with Xaman</strong><span>Sign in with your XRPL wallet.</span></div>
                </div>
                <button
                  onClick={connect}
                  disabled={createSession.isPending}
                  className="ft-entry-connect-button"
                  data-testid="button-connect-wallet"
                  type="button"
                >
                  <span>{createSession.isPending ? 'Opening Xaman…' : 'Connect your wallet'}</span>
                  {createSession.isPending ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
                </button>
                <p className="ft-entry-open-access"><span aria-hidden="true">i</span> Any connected XRPL wallet can enter</p>
              </div>
            ) : (
              <div className="ft-entry-connect-card ft-entry-session-card">
                <div className="ft-entry-connect-intro">
                  <div className="ft-entry-wallet-icon waiting"><QrCode className="size-5" /><span className="pulse-dot" /></div>
                  <div><strong>Waiting for Xaman</strong><span>{statusQuery.isFetching ? 'Listening for your approval…' : 'Scan the code or open the app.'}</span></div>
                </div>
                <div className="ft-entry-session-content">
                  <div className="ft-entry-qr-wrap"><img src={session.qrUrl} alt="Xaman wallet connection QR code" data-testid="img-wallet-qr" /></div>
                  <div className="ft-entry-session-details">
                    <p className="mono break-all">{session.sessionId}</p>
                    <p>Your address never leaves the connection you approve.</p>
                    <a href={session.deeplink} data-testid="link-open-xaman">Open Xaman <ExternalLink className="size-3.5" /></a>
                  </div>
                </div>
                <button className="ft-entry-cancel" onClick={() => setSession(null)} data-testid="button-cancel-wallet" type="button">Cancel and start over <ChevronRight className="size-3.5" /></button>
              </div>
            )}
            <LadyChainConnect onConnected={finishSignIn} />

            <div className="ft-entry-promise-list" id="frogtown-entry-promises">
              <div className="ft-entry-promise">
                <span className="ft-entry-promise-icon private"><LockKeyhole aria-hidden="true" /></span>
                <div><strong>Private means private.</strong><span>Direct and group chats are end-to-end encrypted on-device.</span></div>
              </div>
              <div className="ft-entry-promise">
                <span className="ft-entry-promise-icon public"><Rss aria-hidden="true" /></span>
                <div><strong>Out in the open.</strong><span>The shared timeline is public to Frogtown members.</span></div>
              </div>
            </div>
          </div>
          <footer className="ft-entry-access-foot">
            <span>Wallet address = your identity</span><span>FROGTOWN <b>·</b> XRPL + LADYCHAIN</span>
          </footer>
        </section>
      </div>
      {notice && <Notice message={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}
    </div>
  );
}

function DirectChatDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (conversationId: string) => void }) {
  const { walletAddress } = useWallet();
  const createDirect = useCreateDirectConversation();
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const client = useQueryClient();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (recipient.trim().length < 4 || recipient.trim().length > 42) {
      setError('Enter a 4–17 character username or a complete wallet address.');
      return;
    }
    createDirect.mutate({ data: { recipient: recipient.trim(), fromWalletAddress: walletAddress } }, {
      onSuccess: (conversation) => {
        client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
        onCreated(conversation.id);
      },
      onError: (mutationError) => setError(errorMessage(mutationError, 'Could not start that conversation.')),
    });
  };
  return <Modal title="Start a direct line" eyebrow="private / one-to-one" onClose={onClose}>
    <form onSubmit={submit}>
      <label className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]" htmlFor="direct-recipient">Username or wallet address</label>
      <div className="relative mt-2"><AtSign className="absolute left-3 top-3.5 size-4 text-[hsl(var(--muted-foreground))]" /><input id="direct-recipient" autoFocus value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="@username or r… address" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] py-3 pl-10 pr-3 text-sm outline-none transition placeholder:text-[hsl(var(--muted-foreground)/.6)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.13)]" data-testid="input-direct-recipient" /></div>
      <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Send to a Frogtown username or XRPL/LadyChain wallet address. This starts a private-message request; the recipient can accept, decline, or block you.</p>
      {error && <p className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-direct-error"><CircleAlert className="size-3.5" />{error}</p>}
      <button disabled={createDirect.isPending} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))] disabled:opacity-60" data-testid="button-start-direct-chat">{createDirect.isPending ? <RefreshCw className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} {createDirect.isPending ? 'Sending request…' : 'Send message request'}</button>
    </form>
  </Modal>;
}

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.35)] p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" data-testid="dialog-modal"><div className="w-full max-w-[480px] rounded-t-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl sm:rounded-[1.5rem] sm:p-7"><div className="flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.05em]">{title}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Close dialog" data-testid="button-close-dialog"><X className="size-5" /></button></div><div className="mt-6">{children}</div></div></div>;
}

type ChatConversation = {
  id: string;
  title: string;
  participantLabel: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  encrypted: boolean;
  type: string;
  memberCount: number;
  directStatus: 'pending' | 'accepted' | 'declined';
  requesterAddress: string | null;
  otherWalletAddress: string | null;
  directMessagingBlocked: boolean;
  canManageGroup: boolean;
};

type BlockedWalletView = { walletAddress: string; blockedWalletAddress: string; createdAt: string | Date };

function ChatList({
  conversations,
  selectedId,
  walletAddress,
  blockedWallets,
  onSelect,
  onNewChat,
  onUnblock,
  loading,
  error,
  unblocking,
}: {
  conversations: ChatConversation[];
  selectedId: string;
  walletAddress: string;
  blockedWallets: BlockedWalletView[];
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onUnblock: (address: string) => void;
  loading: boolean;
  error: unknown;
  unblocking: boolean;
}) {
  const [search, setSearch] = useState('');
  const matchingConversations = conversations.filter((conversation) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return `${conversation.title} ${conversation.participantLabel}`.toLowerCase().includes(query);
  });
  const incomingRequests = matchingConversations.filter((conversation) => (
    conversation.type === 'direct'
    && conversation.directStatus === 'pending'
    && conversation.requesterAddress !== walletAddress
  ));
  const chats = matchingConversations.filter((conversation) => !incomingRequests.includes(conversation));
  const renderConversation = (conversation: ChatConversation, request = false) => (
    <button
      key={conversation.id}
      onClick={() => onSelect(conversation.id)}
      className={`group w-full rounded-xl px-3 py-3 text-left transition ${selectedId === conversation.id ? 'bg-[hsl(var(--primary)/.1)]' : 'hover:bg-[hsl(var(--muted)/.7)]'}`}
      data-testid={`button-conversation-${conversation.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${conversation.type === 'group' ? 'bg-[hsl(var(--accent)/.18)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]'}`}>
          {conversation.type === 'group' ? <Hash className="size-4" /> : <AtSign className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{conversation.title || conversation.participantLabel}</span>
            {conversation.encrypted && <LockKeyhole className="size-3 shrink-0 text-[hsl(var(--primary))]" />}
            {conversation.unreadCount > 0 && <span className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[9px] font-bold text-[hsl(var(--accent-foreground))]">{conversation.unreadCount}</span>}
          </div>
          <p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
            {request ? 'Encrypted message request' : conversation.lastMessage || 'No messages yet'}
          </p>
          {conversation.directStatus === 'pending' && !request && <span className="mt-1 inline-flex rounded-full bg-[hsl(var(--accent)/.14)] px-2 py-0.5 text-[9px] font-medium text-[hsl(var(--accent-foreground))]">Request sent · awaiting reply</span>}
          {conversation.directMessagingBlocked && <span className="mt-1 inline-flex rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">Messaging paused</span>}
        </div>
        <span className="mono shrink-0 text-[9px] text-[hsl(var(--muted-foreground)/.7)]">{relativeTime(conversation.lastMessageAt)}</span>
      </div>
    </button>
  );
  return <section className="flex w-full shrink-0 flex-col border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.36)] md:w-[340px] md:border-b-0 md:border-r" data-testid="conversation-list">
    <div className="flex items-center justify-between px-4 pb-3 pt-5"><div><p className="mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">inbox</p><h2 className="mt-1 text-lg font-semibold tracking-[-.04em]">Chats</h2></div><button onClick={onNewChat} className="flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--foreground))] text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))]" aria-label="Start new conversation" data-testid="button-new-chat"><Plus className="size-4" /></button></div>
    <div className="px-4 pb-4"><label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))] focus-within:border-[hsl(var(--primary))]"><Search className="size-3.5 shrink-0" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats or paste an address" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[hsl(var(--muted-foreground)/.72)]" aria-label="Search chats" data-testid="input-search-chats" /><span className="mono text-[9px] opacity-50">/</span></label></div>
    <div className="soft-scrollbar flex max-h-[250px] flex-1 flex-col gap-1 overflow-auto px-2 pb-3 md:max-h-none">
      {loading && [1, 2, 3].map((item) => <div key={item} className="mx-2 animate-pulse rounded-xl px-3 py-3"><div className="h-3 w-2/5 rounded bg-[hsl(var(--muted))]" /><div className="mt-2 h-2 w-3/4 rounded bg-[hsl(var(--muted))]" /></div>)}
      {!loading && Boolean(error) && <div className="m-2 rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] p-3 text-xs leading-5 text-[hsl(var(--destructive))]" data-testid="status-conversations-error">Unable to load your conversations. Try refreshing the page.</div>}
      {!loading && !error && conversations.length === 0 && <div className="m-2 rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="empty-conversations"><MessageCircle className="mb-3 size-4 text-[hsl(var(--primary))]" /><p>No conversations yet.</p><p className="mt-1">Start a private line or find a group room.</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={onNewChat} className="rounded-lg bg-[hsl(var(--foreground))] px-3 py-2 font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]" data-testid="button-empty-new-chat">New direct chat</button><Link href="/groups" className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-medium text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]" data-testid="button-empty-browse-groups">Browse groups</Link></div></div>}
      {!loading && !error && conversations.length > 0 && matchingConversations.length === 0 && <div className="m-2 rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="empty-search-chats"><Search className="mb-3 size-4 text-[hsl(var(--primary))]" /><p>No chats match “{search}”.</p><button onClick={() => setSearch('')} className="mt-2 font-medium text-[hsl(var(--primary))] hover:underline">Clear search</button></div>}
      {!loading && !error && incomingRequests.length > 0 && <div className="pt-2"><p className="px-3 pb-1 mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Message requests · {incomingRequests.length}</p>{incomingRequests.map((conversation) => renderConversation(conversation, true))}</div>}
      {!loading && !error && chats.length > 0 && <div className="pt-2"><p className="px-3 pb-1 mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Your chats</p>{chats.map((conversation) => renderConversation(conversation))}</div>}
      {!loading && !error && blockedWallets.length > 0 && <div className="mt-4 border-t border-[hsl(var(--border))] px-2 pt-4" data-testid="blocked-wallets-list"><p className="px-3 pb-2 mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Blocked wallets</p>{blockedWallets.map((item) => <div key={item.blockedWalletAddress} className="flex items-center gap-2 rounded-xl px-3 py-2"><Ban className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" /><span className="mono min-w-0 flex-1 truncate text-[10px]">{shortAddress(item.blockedWalletAddress)}</span><button type="button" disabled={unblocking} onClick={() => onUnblock(item.blockedWalletAddress)} className="rounded-lg border border-[hsl(var(--border))] px-2 py-1 text-[9px] font-medium hover:border-[hsl(var(--primary))] disabled:opacity-50" data-testid={`button-unblock-${item.blockedWalletAddress}`}>Unblock</button></div>)}</div>}
    </div>
  </section>;
}

function MessagePane({
  conversation,
  onBack,
  isActive,
  blockedWalletAddresses,
  onBlock,
  onUnblock,
  blockPending,
}: {
  conversation: ChatConversation | undefined;
  onBack: () => void;
  isActive: boolean;
  blockedWalletAddresses: string[];
  onBlock: (address: string) => void;
  onUnblock: (address: string) => void;
  blockPending: boolean;
}) {
  const { walletAddress } = useWallet();
  const realtimeStatus = useContext(RealtimeContext);
  const client = useQueryClient();
  const deleteGroupMessageMutation = useDeleteGroupMessage();
  const removeGroupMemberMutation = useRemoveGroupMember();
  const restoreGroupMemberMutation = useRestoreGroupMember();
  const removedGroupMembersQuery = useListRemovedGroupMembers(conversation?.id ?? '', {
    query: { enabled: Boolean(conversation?.type === 'group' && conversation.canManageGroup) },
  });
  const [deleteMessageError, setDeleteMessageError] = useState('');
  const [memberActionError, setMemberActionError] = useState('');
  const deleteGroupMessage = (messageId: string) => {
    if (!conversation || conversation.type !== 'group' || !conversation.canManageGroup) return;
    if (!window.confirm('Delete this message for everyone in the group? This also removes any encrypted history copies.')) return;
    setDeleteMessageError('');
    deleteGroupMessageMutation.mutate({ conversationId: conversation.id, messageId }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id, params) });
        void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
      },
      onError: (error) => setDeleteMessageError(errorMessage(error, 'Could not delete this group message.')),
    });
  };
  const removeGroupMember = (memberWalletAddress: string) => {
    if (!conversation || conversation.type !== 'group' || !conversation.canManageGroup) return;
    if (!window.confirm('Remove this wallet from the group? They will lose server access and be blocked from rejoining until restored. Messages or decrypted text already saved on their device cannot be erased.')) return;
    setMemberActionError('');
    removeGroupMemberMutation.mutate({ conversationId: conversation.id, walletAddress: memberWalletAddress }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListGroupsQueryKey({ walletAddress }) });
        void client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) });
        void removedGroupMembersQuery.refetch();
      },
      onError: (error) => setMemberActionError(errorMessage(error, 'Could not remove this member.')),
    });
  };
  const restoreGroupMember = (memberWalletAddress: string) => {
    if (!conversation || conversation.type !== 'group' || !conversation.canManageGroup) return;
    restoreGroupMemberMutation.mutate({ conversationId: conversation.id, walletAddress: memberWalletAddress }, {
      onSuccess: () => {
        void removedGroupMembersQuery.refetch();
        void client.invalidateQueries({ queryKey: getListGroupsQueryKey({ walletAddress }) });
      },
      onError: (error) => setMemberActionError(errorMessage(error, 'Could not restore access.')),
    });
  };
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [outboxError, setOutboxError] = useState('');
  const [pendingRetry, setPendingRetry] = useState<PendingEncryptedMessage | null>(null);
  const [requestError, setRequestError] = useState('');
  const [encrypting, setEncrypting] = useState(false);
  const messageAttempt = useRef<{
    conversationId: string;
    body: string;
    messageId: string;
    encryptedBody?: string;
  } | null>(null);
  const [showSafetyCode, setShowSafetyCode] = useState(false);
  const [safetyCode, setSafetyCode] = useState('');
  const [keyChanges, setKeyChanges] = useState<ConversationKeyChange[]>([]);
  const [keyTrustError, setKeyTrustError] = useState('');
  const [decryptedMessages, setDecryptedMessages] = useState<DecryptedChatMessage[]>([]);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const lastMarkedMessageId = useRef<string | null>(null);
  const pendingReadMessageId = useRef<string | null>(null);
  const historyShareInFlight = useRef(new Set<string>());
  const historySharePagesInBatch = useRef(0);
  const historySharePassHadFailures = useRef(false);
  const historyMembershipSignatureRef = useRef<string | null>(null);
  const historySeenMessageIds = useRef(new Set<string>());
  const historyLatestMessageOrder = useRef<{ sentAt: number; id: string } | null>(null);
  const historyShareResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [historyWorkCursor, setHistoryWorkCursor] = useState<string | null>(null);
  const [historyWorkPaused, setHistoryWorkPaused] = useState(false);
  const [historyWorkRevision, setHistoryWorkRevision] = useState(0);
  const params = useMemo(() => ({ walletAddress }), [walletAddress]);
  const historyWorkParams = useMemo(
    () => ({ cursor: historyWorkCursor ?? undefined }),
    [historyWorkCursor],
  );
  const messagesQuery = useListConversationMessages(conversation?.id ?? '', params, { query: { enabled: Boolean(conversation?.id), queryKey: getListConversationMessagesQueryKey(conversation?.id ?? '', params), refetchInterval: 30000 } });
  const keysQuery = useGetConversationEncryptionKeys(conversation?.id ?? '', { query: { enabled: Boolean(conversation?.id), queryKey: ['/api/conversations', conversation?.id, 'keys'], refetchInterval: 15000 } });
  const historyMembershipSignature = useMemo(
    () => (keysQuery.data ?? [])
      .map((member) => `${member.walletAddress}:${member.publicKey ?? ''}`)
      .sort()
      .join('|'),
    [keysQuery.data],
  );
  const historySharesQuery = useListConversationHistoryShares(conversation?.id ?? '', { query: { enabled: Boolean(conversation?.id), queryKey: getListConversationHistorySharesQueryKey(conversation?.id ?? ''), refetchInterval: 30000 } });
  const historyWorkQuery = useListConversationHistoryShareWork(conversation?.id ?? '', historyWorkParams, {
    query: {
      enabled: Boolean(conversation?.id && conversation.type === 'group' && isActive && pageVisible && !historyWorkPaused),
      queryKey: [
        ...getListConversationHistoryShareWorkQueryKey(conversation?.id ?? '', historyWorkParams),
        historyWorkRevision,
        walletAddress ?? '',
      ],
      refetchInterval: 30000,
    },
  });
  const pauseHistoryWork = useCallback((durationMs: number) => {
    setHistoryWorkPaused(true);
    if (historyShareResumeTimer.current) clearTimeout(historyShareResumeTimer.current);
    historyShareResumeTimer.current = setTimeout(() => {
      historyShareResumeTimer.current = null;
      setHistoryWorkPaused(false);
    }, durationMs);
  }, []);
  useEffect(() => {
    setHistoryWorkCursor(null);
    setHistoryWorkPaused(false);
    historySharePagesInBatch.current = 0;
    historySharePassHadFailures.current = false;
    historyMembershipSignatureRef.current = null;
    historySeenMessageIds.current.clear();
    historyLatestMessageOrder.current = null;
    historyShareInFlight.current.clear();
    if (historyShareResumeTimer.current) clearTimeout(historyShareResumeTimer.current);
    historyShareResumeTimer.current = null;
    return () => {
      if (historyShareResumeTimer.current) clearTimeout(historyShareResumeTimer.current);
      historyShareResumeTimer.current = null;
    };
  }, [conversation?.id, walletAddress]);
  useEffect(() => {
    if (!conversation?.id || !keysQuery.data) return;
    const previousSignature = historyMembershipSignatureRef.current;
    if (previousSignature !== historyMembershipSignature) {
      setHistoryWorkRevision((revision) => revision + 1);
      historySharePagesInBatch.current = 0;
      historySharePassHadFailures.current = false;
      if (historyShareResumeTimer.current) clearTimeout(historyShareResumeTimer.current);
      historyShareResumeTimer.current = null;
      setHistoryWorkCursor(null);
      setHistoryWorkPaused(false);
    }
    historyMembershipSignatureRef.current = historyMembershipSignature;
  }, [conversation?.id, walletAddress, keysQuery.data, historyMembershipSignature]);
  useEffect(() => {
    if (!conversation?.id || conversation.type !== 'group' || !messagesQuery.data) return;
    let newest = historyLatestMessageOrder.current;
    let foundLateMessage = false;
    for (const message of messagesQuery.data) {
      if (historySeenMessageIds.current.has(message.id)) continue;
      historySeenMessageIds.current.add(message.id);
      const sentAt = Date.parse(message.sentAt);
      if (!Number.isFinite(sentAt)) continue;
      if (newest && sentAt <= newest.sentAt) foundLateMessage = true;
      if (
        !newest
        || sentAt > newest.sentAt
        || (sentAt === newest.sentAt && message.id.localeCompare(newest.id) > 0)
      ) newest = { sentAt, id: message.id };
    }
    historyLatestMessageOrder.current = newest;
    if (!foundLateMessage) return;
    setHistoryWorkRevision((revision) => revision + 1);
    historySharePagesInBatch.current = 0;
    historySharePassHadFailures.current = false;
    if (historyShareResumeTimer.current) clearTimeout(historyShareResumeTimer.current);
    historyShareResumeTimer.current = null;
    setHistoryWorkCursor(null);
    setHistoryWorkPaused(false);
  }, [conversation?.id, conversation?.type, messagesQuery.data]);
  const sendMessage = useSendMessage();
  const acceptRequest = useAcceptConversationRequest();
  const declineRequest = useDeclineConversationRequest();
  const createHistoryShare = useCreateConversationHistoryShare();
  const markConversationRead = useMarkConversationRead();
  const members: ConversationPublicKey[] = keysQuery.data ?? [];
  const missingMembers = members.filter((member) => !member.publicKey);
  const sendBlockedByMissingKeys = conversation?.type !== 'group' && missingMembers.length > 0;
  const otherWalletAddress = conversation?.type === 'direct' ? conversation.otherWalletAddress : null;
  const blockedByMe = Boolean(otherWalletAddress && blockedWalletAddresses.includes(otherWalletAddress));
  const directMessagingBlocked = Boolean(conversation?.type === 'direct' && conversation.directMessagingBlocked);
  const incomingRequest = Boolean(
    conversation?.type === 'direct'
    && conversation.directStatus === 'pending'
    && conversation.requesterAddress !== walletAddress,
  );
  const outgoingRequest = Boolean(
    conversation?.type === 'direct'
    && conversation.directStatus === 'pending'
    && conversation.requesterAddress === walletAddress,
  );
  const hasIntroMessage = Boolean(messagesQuery.data?.length);
  const requestWaitingForReply = outgoingRequest && hasIntroMessage;

  const refreshDirectConversation = () => {
    if (!conversation) return;
    void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
    void client.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id, params) });
  };
  const acceptIncomingRequest = () => {
    if (!conversation) return;
    setRequestError('');
    acceptRequest.mutate({ conversationId: conversation.id }, {
      onSuccess: refreshDirectConversation,
      onError: (error) => setRequestError(errorMessage(error, 'Could not accept this request.')),
    });
  };
  const declineIncomingRequest = () => {
    if (!conversation) return;
    setRequestError('');
    declineRequest.mutate({ conversationId: conversation.id }, {
      onSuccess: () => {
        onBack();
        void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
      },
      onError: (error) => setRequestError(errorMessage(error, 'Could not decline this request.')),
    });
  };

  useEffect(() => {
    if (!walletAddress || !keysQuery.data) {
      setKeyChanges([]);
      setKeyTrustError('');
      return;
    }
    try {
      setKeyChanges(getConversationKeyChanges(walletAddress, keysQuery.data, window.localStorage));
      setKeyTrustError('');
    } catch {
      setKeyChanges([]);
      setKeyTrustError('This browser cannot read or save encryption-key history. Sending is paused; enable site storage, or clear Frogtown site data only after recording the safety code.');
    }
  }, [walletAddress, conversation?.id, keysQuery.data]);

  const acknowledgeKeyChange = (change: ConversationKeyChange) => {
    try {
      trustConversationKeyChange(walletAddress, change.walletAddress, change.publicKey, window.localStorage);
      if (keysQuery.data) {
        setKeyChanges(getConversationKeyChanges(walletAddress, keysQuery.data, window.localStorage));
      }
      setKeyTrustError('');
    } catch {
      setKeyTrustError('This browser could not save the verified encryption key. Sending remains paused.');
    }
  };

  useEffect(() => {
    setDraft('');
    setSendError('');
    messageAttempt.current = null;
    setPendingRetry(null);
    setOutboxError('');
    lastMarkedMessageId.current = null;
    pendingReadMessageId.current = null;
  }, [conversation?.id]);

  useEffect(() => {
    if (!walletAddress || !conversation?.id) {
      setPendingRetry(null);
      return;
    }
    try {
      setPendingRetry(findPendingEncryptedMessage(walletAddress, conversation.id));
      setOutboxError('');
    } catch (error) {
      setPendingRetry(null);
      setOutboxError(errorMessage(error, 'This browser could not read the encrypted retry copy.'));
    }
  }, [walletAddress, conversation?.id]);

  useEffect(() => {
    if (
      !walletAddress
      || !conversation?.id
      || !pendingRetry
      || pendingRetry.conversationId !== conversation.id
      || messagesQuery.isLoading
      || messagesQuery.isError
      || !messagesQuery.data
    ) return;
    const alreadyConfirmed = messagesQuery.data.some((message) =>
      message.id === pendingRetry.messageId
      && message.senderAddress === walletAddress
      && message.body === pendingRetry.encryptedBody);
    if (!alreadyConfirmed) return;
    try {
      removePendingEncryptedMessage(walletAddress, pendingRetry.messageId);
      setPendingRetry(null);
      setOutboxError('');
      setSendError('');
      if (messageAttempt.current?.messageId === pendingRetry.messageId) messageAttempt.current = null;
    } catch (error) {
      setOutboxError(errorMessage(error, 'The message was delivered, but its local retry copy could not be cleared.'));
    }
  }, [walletAddress, conversation?.id, pendingRetry, messagesQuery.data, messagesQuery.isLoading, messagesQuery.isError]);

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
        try {
          removePendingEncryptedMessage(walletAddress, payload.messageId);
          setPendingRetry((current) => current?.messageId === payload.messageId ? null : current);
          setOutboxError('');
        } catch (error) {
          setOutboxError(errorMessage(error, 'The message was delivered, but its local retry copy could not be cleared.'));
        }
      }
    };
    window.addEventListener('swamp-message-created', handleMessageCreated);
    return () => window.removeEventListener('swamp-message-created', handleMessageCreated);
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    const decryptMessages = async () => {
      if (!conversation || !messagesQuery.data || !keysQuery.data) {
        setDecryptedMessages([]);
        return;
      }
      try {
        const identity = await getLocalIdentityKey(walletAddress);
        const historyShares = new Map((historySharesQuery.data ?? []).map((share) => [share.messageId, share]));
        const visible = await Promise.all(messagesQuery.data.map(async (message) => {
          try {
            const historyShare = historyShares.get(message.id);
            const originalBody = historyShare
              ? await decryptForConversation(
                historyShare.body,
                conversation.id,
                historyShare.sharedByAddress,
                walletAddress,
                identity,
                keysQuery.data ?? [],
              )
              : await decryptForConversation(
                message.body,
                conversation.id,
                message.senderAddress,
                walletAddress,
                identity,
                keysQuery.data ?? [],
              );
            const historyPending = !historyShare
              && originalBody === 'This message was not encrypted for this device.'
              && (historyWorkQuery.data?.items ?? []).some((item) => item.messageId === message.id);
            const body = historyPending
              ? 'Earlier encrypted message — waiting for a current member to open this room and share its history.'
              : originalBody;
            return {
              ...message,
              body,
              decryptionFailed: false,
              historyPending,
              historyShared: Boolean(historyShare),
              historySharedByAddress: historyShare?.sharedByAddress ?? null,
              recipientAddresses: getEncryptedMessageRecipients(message.body),
            };
          } catch {
            return {
              ...message,
              body: 'Unable to decrypt this message with the available wallet key.',
              decryptionFailed: true,
              historyPending: false,
              historyShared: false,
              historySharedByAddress: null,
              recipientAddresses: getEncryptedMessageRecipients(message.body),
            };
          }
        }));
        if (!cancelled) setDecryptedMessages(visible);
      } catch {
        if (!cancelled) setDecryptedMessages([]);
      }
    };
    void decryptMessages();
    return () => { cancelled = true; };
  }, [conversation?.id, messagesQuery.data, keysQuery.data, historySharesQuery.data, historyWorkQuery.data, walletAddress]);

  useEffect(() => {
    if (
      !conversation
      || conversation.type !== 'group'
      || !isActive
      || !pageVisible
      || historyWorkPaused
      || historyWorkQuery.isError
      || !walletAddress
      || !historyWorkQuery.data
      || !keysQuery.data?.some((member) => member.walletAddress === walletAddress && member.publicKey)
      || keysQuery.isError
      || keyChanges.length > 0
      || keyTrustError
    ) return;
    let cancelled = false;
    const page = historyWorkQuery.data;
    const shareHistory = async () => {
      let sharedAny = false;
      let pageHadFailure = false;
      try {
        const identity = await getLocalIdentityKey(walletAddress);
        for (const item of page.items) {
          if (cancelled) break;
          const taskKey = `${conversation.id}:${item.messageId}:${item.recipientAddress}`;
          if (historyShareInFlight.current.has(taskKey)) continue;
          historyShareInFlight.current.add(taskKey);
          try {
            const plaintext = await decryptForConversation(
              item.body,
              conversation.id,
              item.senderAddress,
              walletAddress,
              identity,
              keysQuery.data,
            );
            if (plaintext === 'This message was not encrypted for this device.') continue;
            const encryptedShare = await encryptForConversation(
              plaintext,
              conversation.id,
              walletAddress,
              identity,
              [{ walletAddress: item.recipientAddress, publicKey: item.recipientPublicKey }],
            );
            await createHistoryShare.mutateAsync({
              conversationId: conversation.id,
              data: {
                messageId: item.messageId,
                recipientAddress: item.recipientAddress,
                body: encryptedShare,
              },
            });
            sharedAny = true;
          } catch {
            // Keep scanning; this pair is retried from the first page after the current pass reaches the end.
            pageHadFailure = true;
          } finally {
            historyShareInFlight.current.delete(taskKey);
          }
        }
      } catch {
        // Keep the original encrypted history intact if this device cannot access its local key.
        pageHadFailure = true;
      }
      if (pageHadFailure) historySharePassHadFailures.current = true;
      if (sharedAny && !cancelled) {
        await client.invalidateQueries({ queryKey: getListConversationHistorySharesQueryKey(conversation.id) }).catch(() => {});
      }
      if (cancelled) return;
      if (page.hasMore && page.nextCursor) {
        historySharePagesInBatch.current += 1;
        setHistoryWorkCursor(page.nextCursor);
        if (historySharePagesInBatch.current >= 4) {
          historySharePagesInBatch.current = 0;
          pauseHistoryWork(5_000);
        }
      } else if (page.hasMore) {
        historySharePagesInBatch.current = 0;
        historySharePassHadFailures.current = false;
        setHistoryWorkCursor(null);
        pauseHistoryWork(30_000);
      } else if (historySharePassHadFailures.current) {
        historySharePagesInBatch.current = 0;
        historySharePassHadFailures.current = false;
        setHistoryWorkCursor(null);
        pauseHistoryWork(30_000);
      } else {
        historySharePagesInBatch.current = 0;
        if (page.nextCursor && page.nextCursor !== historyWorkCursor) {
          setHistoryWorkCursor(page.nextCursor);
        } else if (!page.nextCursor && historyWorkCursor) {
          setHistoryWorkCursor(null);
        }
      }
    };
    void shareHistory();
    return () => { cancelled = true; };
  }, [
    conversation?.id,
    conversation?.type,
    isActive,
    pageVisible,
    historyWorkPaused,
    historyWorkQuery.isError,
    walletAddress,
    historyWorkQuery.data,
    historyWorkCursor,
    keysQuery.data,
    keysQuery.isError,
    keyChanges.length,
    keyTrustError,
    createHistoryShare.mutateAsync,
    client,
    pauseHistoryWork,
  ]);

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
    if (
      !conversation
      || !draft.trim()
      || pendingRetry
      || outboxError
      || !keysQuery.data
      || sendBlockedByMissingKeys
      || keyChanges.length > 0
      || keyTrustError
      || incomingRequest
      || directMessagingBlocked
      || requestWaitingForReply
      || sendMessage.isPending
      || encrypting
    ) return;
    setSendError('');
    const body = draft.trim();
    const existingAttempt = messageAttempt.current;
    const attempt = existingAttempt?.conversationId === conversation.id && existingAttempt.body === body
      ? existingAttempt
      : { conversationId: conversation.id, body, messageId: crypto.randomUUID() };
    messageAttempt.current = attempt;
    setEncrypting(true);
    try {
      if (!attempt.encryptedBody) {
        const identity = await getLocalIdentityKey(walletAddress);
        attempt.encryptedBody = await encryptForConversation(
          body,
          conversation.id,
          walletAddress,
          identity,
          keysQuery.data,
          conversation.type === 'group',
        );
      }
      const retryCopy: PendingEncryptedMessage = {
        conversationId: conversation.id,
        messageId: attempt.messageId,
        encryptedBody: attempt.encryptedBody,
        createdAt: new Date().toISOString(),
      };
      savePendingEncryptedMessage(walletAddress, retryCopy);
      setPendingRetry(retryCopy);
      setOutboxError('');
      setDraft('');
      sendMessage.mutate({ conversationId: conversation.id, data: { messageId: attempt.messageId, senderAddress: walletAddress, body: attempt.encryptedBody } }, {
        onSuccess: () => {
          if (messageAttempt.current?.messageId === attempt.messageId) messageAttempt.current = null;
          try {
            removePendingEncryptedMessage(walletAddress, attempt.messageId);
            setPendingRetry((current) => current?.messageId === attempt.messageId ? null : current);
            setOutboxError('');
          } catch (error) {
            setOutboxError(errorMessage(error, 'The message was delivered, but its local retry copy could not be cleared.'));
          }
          setDraft('');
          client.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id, params) });
          client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
          void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
          void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
        },
        onError: (error) => {
          if (messageAttempt.current?.messageId !== attempt.messageId) return;
          setDraft(body);
          setSendError(errorMessage(error, 'Could not confirm delivery. Retry the saved encrypted message below.'));
        },
      });
    } catch (error) {
      setSendError(errorMessage(error, 'The message could not be encrypted on this device.'));
    } finally {
      setEncrypting(false);
    }
  };
  const retryPendingMessage = () => {
    if (!conversation || !pendingRetry || pendingRetry.conversationId !== conversation.id || sendMessage.isPending) return;
    setSendError('');
    sendMessage.mutate({
      conversationId: pendingRetry.conversationId,
      data: {
        messageId: pendingRetry.messageId,
        senderAddress: walletAddress,
        body: pendingRetry.encryptedBody,
      },
    }, {
      onSuccess: () => {
        if (messageAttempt.current?.messageId === pendingRetry.messageId) messageAttempt.current = null;
        try {
          removePendingEncryptedMessage(walletAddress, pendingRetry.messageId);
          setPendingRetry(null);
          setOutboxError('');
        } catch (error) {
          setOutboxError(errorMessage(error, 'The message was delivered, but its local retry copy could not be cleared.'));
        }
        setDraft('');
        setSendError('');
        void client.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversation.id, params) });
        void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
        void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
      },
      onError: (error) => setSendError(errorMessage(error, 'Delivery is still unconfirmed. The exact encrypted message is saved for another retry.')),
    });
  };
  const discardPendingRetry = () => {
    if (!pendingRetry || !window.confirm('Discard this saved encrypted message? It will not be sent unless you write it again.')) return;
    try {
      removePendingEncryptedMessage(walletAddress, pendingRetry.messageId);
      setPendingRetry(null);
      setSendError('');
      setOutboxError('');
      if (messageAttempt.current?.messageId === pendingRetry.messageId) messageAttempt.current = null;
      setDraft('');
    } catch (error) {
      setOutboxError(errorMessage(error, 'Frogtown could not remove the saved encrypted message.'));
    }
  };
  if (!conversation) return <div className="hidden min-w-0 flex-1 items-center justify-center p-8 md:flex"><div className="max-w-sm text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/.35)] text-[hsl(var(--foreground))]"><MessageCircle className="size-6" /></div><h2 className="mt-5 text-2xl font-semibold tracking-[-.05em]">Pick a conversation</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Your private lines live here. Start one with any XRPL or LadyChain address.</p></div></div>;
  return <section className="flex min-h-[520px] min-w-0 flex-1 flex-col bg-[hsl(var(--background)/.42)]" data-testid="message-pane">
      {conversation.type === 'group' && <div className="mx-4 mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] px-4 py-2.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]" role="note" data-testid="status-group-history-policy">Older group messages may be shared with new members by an existing member’s device. They stay end-to-end encrypted; Frogtown cannot read them.</div>}
      {conversation.type === 'group' && decryptedMessages.some((message) => message.historyPending) && <div className="mx-4 mt-3 rounded-xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.06)] px-4 py-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]" role="status" data-testid="status-group-history-sharing">Older messages are end-to-end encrypted. They will appear when an existing member opens this room and their device shares them; Frogtown cannot read them.</div>}
      {keyTrustError && <div className="mx-4 mt-3 rounded-xl border border-[hsl(var(--destructive)/.24)] bg-[hsl(var(--destructive)/.06)] px-4 py-3 text-xs leading-5 text-[hsl(var(--destructive))]" role="alert" data-testid="warning-encryption-key-storage">{keyTrustError}</div>}
      {keyChanges.length > 0 && <div className="mx-4 mt-3 rounded-xl border border-[hsl(var(--accent)/.38)] bg-[hsl(var(--accent)/.08)] p-4 text-xs leading-5" role="alert" data-testid="warning-encryption-key-change">
        <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[hsl(var(--accent))]" /><div className="min-w-0 flex-1">
          <p className="font-semibold">A chat member’s encryption key changed</p>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">This key differs from the one previously seen on this device. Compare the current safety code with the member through a separate trusted channel before accepting it. Older messages may not decrypt with the new key.</p>
          <div className="mt-3 space-y-2">{keyChanges.map((change) => <div key={change.walletAddress} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] px-3 py-2"><span className="mono text-[10px]">{shortAddress(change.walletAddress)}</span><button type="button" onClick={() => acknowledgeKeyChange(change)} className="min-h-8 rounded-lg bg-[hsl(var(--foreground))] px-3 text-[10px] font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]" data-testid={`button-trust-changed-key-${change.walletAddress}`}>I verified the safety code</button></div>)}</div>
        </div></div>
      </div>}
     <div className="flex justify-end px-4 pt-2 md:px-7"><span className={`inline-flex items-center gap-1.5 text-[10px] ${realtimeStatus === 'live' ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`} role="status" data-testid="status-realtime"><span className={`size-1.5 rounded-full ${realtimeStatus === 'live' ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground))]'}`} />{realtimeStatus === 'live' ? 'Live updates connected' : 'Reconnecting to live updates'}</span></div>
       <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-4 md:px-7">
         <button onClick={onBack} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden" aria-label="Back to conversations" data-testid="button-back-conversations">
           <ArrowLeft className="size-4" />
         </button>
         <div className="flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]">
           {conversation.type === 'group' ? <Hash className="size-4" /> : <AtSign className="size-4" />}
         </div>
         <div className="min-w-0">
           <div className="flex items-center gap-2">
             <h2 className="truncate text-sm font-semibold">{conversation.title}</h2>
             <button onClick={() => setShowSafetyCode(true)} className="flex items-center gap-1 text-[10px] text-[hsl(var(--primary))] hover:underline" data-testid="button-show-safety-code">
               <LockKeyhole className="size-3" /> end-to-end
             </button>
           </div>
           <p className="mono mt-0.5 truncate text-[10px] text-[hsl(var(--muted-foreground))]">
             {conversation.participantLabel} {conversation.memberCount > 1 ? `· ${conversation.memberCount} members` : ''}
           </p>
         </div>
         {conversation.type === 'group' ? (
           <details className="relative ml-auto" data-testid="group-member-roster">
             <summary className="cursor-pointer list-none rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[10px] font-medium hover:border-[hsl(var(--primary))]">
               Members · {members.length}
             </summary>
             <div className="absolute right-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-xl">
               <p className="mb-2 text-xs font-semibold">People in this room</p>
               {keysQuery.isLoading ? (
                 <p className="py-3 text-xs text-[hsl(var(--muted-foreground))]" role="status">Loading members…</p>
               ) : keysQuery.isError ? (
                 <p className="py-3 text-xs text-[hsl(var(--destructive))]" role="alert">Could not load the member list.</p>
               ) : (
                 <ul className="max-h-64 space-y-2 overflow-y-auto">
                   {members.map((member) => (
                     <li key={member.walletAddress} className="flex items-center justify-between gap-3 rounded-lg bg-[hsl(var(--muted)/.45)] px-2.5 py-2">
                       <div className="min-w-0">
                         <p className="truncate text-xs font-medium" title={member.walletAddress}>
                           {member.username ? `@${member.username}` : shortAddress(member.walletAddress)}
                         </p>
                         <p className="mono mt-0.5 truncate text-[9px] text-[hsl(var(--muted-foreground))]">
                           {shortAddress(member.walletAddress)} · {member.publicKey ? 'Encryption key ready' : 'Key not set'}
                         </p>
                       </div>
                       <HermitTick walletAddress={member.walletAddress} className="size-3.5 shrink-0" />
                        {conversation.canManageGroup && member.walletAddress !== walletAddress && !member.isGroupCreator && (
                          <button
                            type="button"
                            disabled={removeGroupMemberMutation.isPending}
                            onClick={() => removeGroupMember(member.walletAddress)}
                            className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-[9px] font-medium text-[hsl(var(--destructive))] hover:border-[hsl(var(--destructive))] disabled:opacity-50"
                            aria-label={`Remove ${member.username ? `@${member.username}` : shortAddress(member.walletAddress)} from group`}
                          >
                            Remove
                          </button>
                        )}
                     </li>
                   ))}
                 </ul>
               )}
                {conversation.canManageGroup && (
                  <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
                    <p className="text-[10px] font-semibold">Removed members</p>
                    {memberActionError && <p className="mt-2 text-[10px] text-[hsl(var(--destructive))]" role="alert">{memberActionError}</p>}
                    {removedGroupMembersQuery.isLoading ? (
                      <p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">Loading removed wallets…</p>
                    ) : removedGroupMembersQuery.data?.length ? (
                      <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                        {removedGroupMembersQuery.data.map((member) => (
                          <li key={member.walletAddress} className="flex items-center justify-between gap-2 rounded-lg bg-[hsl(var(--muted)/.45)] px-2.5 py-2">
                            <span className="mono truncate text-[9px]" title={member.walletAddress}>{shortAddress(member.walletAddress)}</span>
                            <button type="button" disabled={restoreGroupMemberMutation.isPending} onClick={() => restoreGroupMember(member.walletAddress)} className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-[9px] font-medium hover:border-[hsl(var(--primary))] disabled:opacity-50">Restore</button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">No wallets have been removed.</p>
                    )}
                  </div>
                )}
             </div>
           </details>
         ) : otherWalletAddress && !incomingRequest ? (
           blockedByMe ? (
             <button type="button" onClick={() => onUnblock(otherWalletAddress)} disabled={blockPending} className="ml-auto rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[10px] font-medium hover:border-[hsl(var(--primary))] disabled:opacity-50" data-testid="button-unblock-chat-wallet">Unblock</button>
           ) : (
             <button type="button" onClick={() => onBlock(otherWalletAddress)} disabled={blockPending} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))] disabled:opacity-50" data-testid="button-block-chat-wallet">
               <Ban className="size-3" /> Block
             </button>
           )
         ) : null}
       </div>
        <div className="chat-wallpaper soft-scrollbar relative flex flex-1 flex-col gap-4 overflow-auto px-4 py-6 md:px-10" data-testid="chat-message-history">
          {(messagesQuery.isLoading || keysQuery.isLoading) && [1, 2, 3].map((item) => (
            <div key={item} className={`flex animate-pulse ${item % 2 ? 'justify-start' : 'justify-end'}`}>
              <div className="h-14 w-44 rounded-2xl bg-[hsl(var(--muted))]" />
            </div>
          ))}
          {(messagesQuery.isError || keysQuery.isError) && (
            <div className="m-auto max-w-sm rounded-2xl border border-[hsl(var(--destructive)/.16)] bg-[hsl(var(--card)/.92)] p-5 text-center text-sm text-[hsl(var(--muted-foreground))] shadow-sm" data-testid="status-messages-error">
              <CircleAlert className="mx-auto mb-3 size-5 text-[hsl(var(--destructive))]" />Messages or encryption keys could not be loaded. Refresh to try again.
            </div>
          )}
          {!messagesQuery.isLoading && !messagesQuery.isError && messagesQuery.data?.length === 0 && (
            <div className="m-auto max-w-sm rounded-2xl border border-[hsl(var(--border)/.8)] bg-[hsl(var(--card)/.92)] p-5 text-center shadow-sm">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"><LockKeyhole className="size-5" /></div>
              <p className="mt-4 text-sm font-medium">This line is quiet.</p>
              <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Send the first end-to-end encrypted message.</p>
            </div>
          )}
          {deleteMessageError && <p className="self-center rounded-lg bg-[hsl(var(--destructive)/.08)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" role="alert">{deleteMessageError}</p>}
          {decryptedMessages.map((message) => <ChatMessageItem key={message.id} message={message} isGroup={conversation.type === 'group'} canDelete={conversation.canManageGroup} onDelete={() => deleteGroupMessage(message.id)} />)}
        </div>
      <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.45)] p-4 md:px-7">
        {outboxError && <p className="mb-3 rounded-lg border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] px-3 py-2 text-xs leading-5 text-[hsl(var(--destructive))]" role="alert" data-testid="status-message-outbox-error">{outboxError}</p>}
        {pendingRetry?.conversationId === conversation.id && <div className="mb-3 rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-4" role="status" data-testid="status-pending-encrypted-message">
          <p className="text-sm font-semibold">Message delivery is not confirmed</p>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">This tab saved the exact encrypted message before sending, so a reload will not change it or create a duplicate. Only encrypted content is saved; retry to check delivery, or discard this saved send.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={retryPendingMessage} disabled={sendMessage.isPending} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-3 text-xs font-semibold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--foreground))] disabled:opacity-50" data-testid="button-retry-encrypted-message">{sendMessage.isPending ? <RefreshCw className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Retry encrypted message</button>
            <button type="button" onClick={discardPendingRetry} disabled={sendMessage.isPending} className="min-h-9 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-medium hover:border-[hsl(var(--destructive))] disabled:opacity-50" data-testid="button-discard-encrypted-message">Discard saved send</button>
          </div>
        </div>}
        {missingMembers.length > 0 && <p className="mb-3 rounded-lg border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] px-3 py-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="status-missing-member-keys">{conversation.type === 'group' ? <>Encrypted messages will go only to members with registered keys. These members will not receive messages until they set up encryption: {missingMembers.map((member) => shortAddress(member.walletAddress)).join(', ')}.</> : <>Encrypted sending is paused until the other member registers a device key: {missingMembers.map((member) => shortAddress(member.walletAddress)).join(', ')}.</>}</p>}
        {keyChanges.length > 0 && <p className="mb-3 rounded-lg border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] px-3 py-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="status-key-change-send-paused">Sending is paused until you verify the changed encryption key above.</p>}
        {keyTrustError && <p className="mb-3 rounded-lg border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] px-3 py-2 text-xs leading-5 text-[hsl(var(--destructive))]" data-testid="status-key-trust-send-paused">{keyTrustError}</p>}
        {incomingRequest && !directMessagingBlocked ? <div className="rounded-xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.06)] p-4" data-testid="incoming-message-request">
          <p className="text-sm font-semibold">Private-message request</p>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">This wallet sent an encrypted introduction. Accept to allow replies, decline to close the request, or block to prevent future direct messages. Group rooms are not affected.</p>
          {requestError && <p className="mt-2 text-xs text-[hsl(var(--destructive))]" role="alert">{requestError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={acceptIncomingRequest} disabled={acceptRequest.isPending || declineRequest.isPending} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-3 text-xs font-semibold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--foreground))] disabled:opacity-50" data-testid="button-accept-message-request">{acceptRequest.isPending ? <RefreshCw className="size-3 animate-spin" /> : <Check className="size-3" />} Accept</button>
            <button type="button" onClick={declineIncomingRequest} disabled={acceptRequest.isPending || declineRequest.isPending} className="min-h-9 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-medium hover:border-[hsl(var(--destructive))] disabled:opacity-50" data-testid="button-decline-message-request">Decline</button>
            {otherWalletAddress && <button type="button" onClick={() => onBlock(otherWalletAddress)} disabled={blockPending} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-medium text-[hsl(var(--destructive))] hover:border-[hsl(var(--destructive))] disabled:opacity-50" data-testid="button-block-message-request"><Ban className="size-3" /> Block</button>}
          </div>
        </div> : directMessagingBlocked ? <div className="rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] p-4" role="status" data-testid="direct-messaging-blocked">
          <p className="text-sm font-semibold">Direct messaging is paused</p>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Existing encrypted history remains available. Group conversations are unaffected.</p>
          {blockedByMe && otherWalletAddress && <button type="button" onClick={() => onUnblock(otherWalletAddress)} disabled={blockPending} className="mt-3 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:border-[hsl(var(--primary))] disabled:opacity-50" data-testid="button-unblock-paused-chat">Unblock this wallet</button>}
        </div> : requestWaitingForReply ? <div className="rounded-xl border border-[hsl(var(--accent)/.3)] bg-[hsl(var(--accent)/.08)] p-4" role="status" data-testid="outgoing-request-waiting">
          <p className="text-sm font-semibold">Introduction sent</p>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your encrypted message is waiting in their requests. You can send another message after they accept.</p>
        </div> : <form onSubmit={submit} className="relative">
           <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(event as unknown as FormEvent); } }} rows={1} disabled={!keysQuery.data || sendBlockedByMissingKeys || keyChanges.length > 0 || Boolean(keyTrustError) || sendMessage.isPending || encrypting || requestWaitingForReply || Boolean(pendingRetry) || Boolean(outboxError)} placeholder={pendingRetry ? 'Retry or discard the saved encrypted message above…' : outgoingRequest ? 'Write your encrypted introduction…' : keyChanges.length > 0 ? 'Verify the changed encryption key before sending…' : sendBlockedByMissingKeys ? 'Waiting for the other member to enable encryption…' : 'Write something unbothered…'} className="soft-scrollbar min-h-[52px] w-full resize-none rounded-2xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] py-4 pl-4 pr-14 text-sm outline-none transition placeholder:text-[hsl(var(--muted-foreground)/.7)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.13)] disabled:opacity-60" data-testid="input-message" />
           <button type="submit" disabled={!draft.trim() || sendMessage.isPending || encrypting || !keysQuery.data || sendBlockedByMissingKeys || keyChanges.length > 0 || Boolean(keyTrustError) || requestWaitingForReply || Boolean(pendingRetry) || Boolean(outboxError)} className="absolute bottom-2.5 right-2.5 flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Send encrypted message" data-testid="button-send-message">{sendMessage.isPending || encrypting ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
        </form>}
        {sendError && <p className="mt-2 flex items-center gap-1 text-xs text-[hsl(var(--destructive))]" data-testid="text-send-error"><CircleAlert className="size-3" />{sendError}</p>}
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-[hsl(var(--muted-foreground))]"><ShieldCheck className="size-3 text-[hsl(var(--primary))]" /> Message content is encrypted on your device; verify the safety code with members.</p>
      </div>
     {showSafetyCode && <Modal title="Encryption safety code" eyebrow="verify / out of band" onClose={() => setShowSafetyCode(false)}><p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">Compare this code with the other member using a separate trusted channel. Matching codes help detect a substituted public key. Until verified, a malicious server could replace keys.</p><div className="mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center"><p className="mono break-all text-lg font-semibold tracking-[.08em]" data-testid="text-encryption-safety-code">{safetyCode || 'Loading…'}</p></div><p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Encrypted key recovery backups are available in Settings; save one before changing devices. Frogtown’s custom encryption protocol has not been independently audited.</p></Modal>}
  </section>;
}

function ChatWorkspace({ onNewChat }: { onNewChat: () => void }) {
  const { walletAddress } = useWallet();
  const client = useQueryClient();
  const params = useMemo(() => ({ walletAddress }), [walletAddress]);
  const query = useListConversations(params, { query: { enabled: Boolean(walletAddress), queryKey: getListConversationsQueryKey(params), refetchInterval: 30000 } });
  const blocksQuery = useListBlockedWallets({ query: { enabled: Boolean(walletAddress), queryKey: getListBlockedWalletsQueryKey(), refetchInterval: 30000 } });
  const createBlock = useBlockWallet();
  const removeBlock = useUnblockWallet();
  const conversations = query.data ?? [];
  const blockedWallets = blocksQuery.data ?? [];
  const [blockNotice, setBlockNotice] = useState<{ message: string; tone: 'error' | 'success' } | null>(null);
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
  const refreshBlockState = () => {
    void client.invalidateQueries({ queryKey: getListBlockedWalletsQueryKey() });
    void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
  };
  const blockWallet = (address: string) => {
    createBlock.mutate({ data: { blockedWalletAddress: address } }, {
      onSuccess: () => {
        setBlockNotice({ message: 'This wallet is blocked from private messaging. Group chats remain unchanged.', tone: 'success' });
        refreshBlockState();
      },
      onError: (error) => setBlockNotice({ message: errorMessage(error, 'Could not block this wallet.'), tone: 'error' }),
    });
  };
  const unblockWallet = (address: string) => {
    removeBlock.mutate({ blockedWalletAddress: address }, {
      onSuccess: () => {
        setBlockNotice({ message: 'Wallet unblocked. A new message request may be sent.', tone: 'success' });
        refreshBlockState();
      },
      onError: (error) => setBlockNotice({ message: errorMessage(error, 'Could not unblock this wallet.'), tone: 'error' }),
    });
  };
  return <>
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {(mobileList || !selectedId) && <ChatList
        conversations={conversations}
        selectedId={selectedId}
        walletAddress={walletAddress}
        blockedWallets={blockedWallets}
        onSelect={select}
        onNewChat={onNewChat}
        onUnblock={unblockWallet}
        loading={query.isLoading}
        error={query.error}
        unblocking={removeBlock.isPending}
      />}
      <MessagePane
        conversation={selected}
        isActive={isDesktop || !mobileList}
        onBack={() => setMobileList(true)}
        blockedWalletAddresses={blockedWallets.map((item) => item.blockedWalletAddress)}
        onBlock={blockWallet}
        onUnblock={unblockWallet}
        blockPending={createBlock.isPending || removeBlock.isPending}
      />
    </div>
    {blockNotice && <Notice message={blockNotice.message} tone={blockNotice.tone} onClose={() => setBlockNotice(null)} />}
  </>;
}

function GroupsPage({ onOpenGroup }: { onOpenGroup: (conversationId: string) => void }) {
  const { walletAddress } = useWallet();
  const client = useQueryClient();
  const params = useMemo(() => ({ walletAddress }), [walletAddress]);
  const groupsQuery = useListGroups(params, { query: { enabled: Boolean(walletAddress), queryKey: getListGroupsQueryKey(params), refetchInterval: 10000 } });
  const createGroup = useCreateGroup();
  const joinGroup = useJoinGroup();
  const createInvite = useCreateGroupInvite();
  const revokeInvite = useRevokeGroupInvite();
  const deleteGroupMutation = useDeleteGroup();
  const [dialog, setDialog] = useState<'create' | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'success' } | null>(null);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
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
  const shareInvite = (groupId: string) => {
    createInvite.mutate({ groupId }, {
      onSuccess: ({ token }) => {
        const inviteUrl = `${window.location.origin}/?groupInvite=${encodeURIComponent(token)}`;
        setInviteLinks((current) => ({ ...current, [groupId]: inviteUrl }));
        void navigator.clipboard?.writeText(inviteUrl)
          .then(() => setNotice({ message: 'Invite link copied. Anyone with it can join this room.', tone: 'success' }))
          .catch(() => setNotice({ message: 'Invite link is ready below. Copy it to share.', tone: 'success' }));
      },
      onError: (error) => setNotice({ message: errorMessage(error, 'Could not create an invite link.'), tone: 'error' }),
    });
  };
  const removeGroup = (groupId: string, groupName: string) => {
    if (!window.confirm(`Permanently delete “${groupName}” and all group messages and shared encrypted history? This cannot be undone.`)) return;
    deleteGroupMutation.mutate({ groupId }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListGroupsQueryKey(params) });
        void client.invalidateQueries({ queryKey: getListConversationsQueryKey(params) });
        setNotice({ message: `“${groupName}” and its group history were permanently deleted.`, tone: 'success' });
      },
      onError: (error) => setNotice({ message: errorMessage(error, 'Could not delete this group.'), tone: 'error' }),
    });
  };
  return (
    <AppShell title="Community rooms" eyebrow="the $HERMIT community / find your people">
      <div className="mx-auto max-w-[1150px] p-5 md:p-8 lg:p-10">
        <div className="appear flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Users className="size-4 text-[hsl(var(--accent))]" /><span>XRPL community rooms</span></div>
            <h2 className="mt-3 max-w-xl text-4xl font-semibold leading-[.95] tracking-[-.07em] md:text-6xl">Find your<br /><span className="text-[hsl(var(--primary))]">people.</span></h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">Public rooms for XRPL ideas, project updates, and conversations that bring the $HERMIT community closer together.</p>
          </div>
          <button onClick={() => setDialog('create')} className="flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))]" data-testid="button-create-group">
            <Plus className="size-4" /> Create a group
          </button>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groupsQuery.isLoading && [1, 2, 3].map((item) => <div key={item} className="h-56 animate-pulse rounded-[1.25rem] bg-[hsl(var(--muted))]" />)}
          {groupsQuery.isError && <div className="col-span-full rounded-2xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] p-5 text-sm text-[hsl(var(--destructive))]" data-testid="status-groups-error">Groups are having a muddy moment. Refresh to try again.</div>}
          {!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && (
            <div className="col-span-full rounded-[1.25rem] border border-dashed border-[hsl(var(--border))] p-10 text-center" data-testid="empty-groups">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/.4)]"><Users className="size-5" /></div>
              <h3 className="mt-4 text-lg font-semibold">No rooms in the reeds yet.</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">Create the first group and give the community somewhere to land.</p>
            </div>
          )}
          {groups.map((group, index) => (
            <article key={group.id} className={`lift appear rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 ${index % 3 === 1 ? 'appear-delay-1' : index % 3 === 2 ? 'appear-delay-2' : ''}`} data-testid={`card-group-${group.id}`}>
              <div className="flex items-start justify-between">
                <div className={`flex size-11 items-center justify-center rounded-2xl ${index % 2 ? 'bg-[hsl(var(--accent)/.15)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]'}`}><Hash className="size-5" /></div>
                <span className="mono rounded-full bg-[hsl(var(--muted))] px-2 py-1 text-[9px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">Public room</span>
              </div>
              <h3 className="mt-6 text-lg font-semibold tracking-[-.03em]">{group.name}</h3>
              <p className="mt-2 min-h-10 text-sm leading-5 text-[hsl(var(--muted-foreground))]">{group.description || 'A public XRPL room.'}</p>
              <p className="mt-3 text-[10px] text-[hsl(var(--muted-foreground))]">
                Started by <span className="font-medium text-[hsl(var(--foreground))]">{group.creatorUsername ? `@${group.creatorUsername}` : shortAddress(group.creatorAddress)}</span>
                {group.creatorUsername && <span className="mono ml-1">{shortAddress(group.creatorAddress)}</span>}
              </p>
              <div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border)/.75)] pt-4">
                <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><Users className="size-3.5" /> {group.memberCount} members</span>
                {group.isJoined ? (
                  <button onClick={() => onOpenGroup(group.conversationId)} className="flex items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] hover:underline" data-testid={`button-open-group-${group.id}`}>Open room <ArrowUpRight className="size-3.5" /></button>
                ) : !group.canJoin ? (
                  <span className="rounded-lg border border-[hsl(var(--destructive)/.25)] px-3 py-2 text-xs font-medium text-[hsl(var(--destructive))]" data-testid={`status-removed-from-group-${group.id}`}>Access removed</span>
                ) : (
                  <button onClick={() => join(group.id)} disabled={joinGroup.isPending} className="flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)] disabled:opacity-50" data-testid={`button-join-group-${group.id}`}>
                    {joinGroup.isPending ? <RefreshCw className="size-3 animate-spin" /> : <DoorOpen className="size-3.5" />} Join
                  </button>
                )}
              </div>
              {group.canManage && <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => shareInvite(group.id)} disabled={createInvite.isPending} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-medium hover:border-[hsl(var(--primary))] disabled:opacity-50" data-testid={`button-share-group-${group.id}`}>
                  {createInvite.isPending ? <RefreshCw className="size-3 animate-spin" /> : <Copy className="size-3.5" />} Create invite link
                </button>
                <button type="button" onClick={() => removeGroup(group.id, group.name)} disabled={deleteGroupMutation.isPending} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[hsl(var(--destructive)/.25)] px-3 text-xs font-medium text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.06)] disabled:opacity-50" data-testid={`button-delete-group-${group.id}`}>
                  <Trash2 className="size-3.5" /> Delete group
                </button>
                {inviteLinks[group.id] && <div className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-3">
                  <label htmlFor={`group-invite-${group.id}`} className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Share this link · previous link was replaced</label>
                  <div className="mt-2 flex gap-2">
                    <input id={`group-invite-${group.id}`} readOnly value={inviteLinks[group.id]} className="min-w-0 flex-1 rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2 py-2 text-xs" onFocus={(event) => event.currentTarget.select()} />
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(inviteLinks[group.id]).then(() => setNotice({ message: 'Invite link copied.', tone: 'success' })).catch(() => setNotice({ message: 'Select and copy the invite link.', tone: 'success' })); }} className="rounded-lg bg-[hsl(var(--foreground))] px-3 text-xs font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]">Copy</button>
                  </div>
                  <button type="button" onClick={() => revokeInvite.mutate({ groupId: group.id }, { onSuccess: () => { setInviteLinks((current) => { const next = { ...current }; delete next[group.id]; return next; }); setNotice({ message: 'The group invite was revoked.', tone: 'success' }); }, onError: (error) => setNotice({ message: errorMessage(error, 'Could not revoke the invite.'), tone: 'error' }) })} className="mt-2 text-[10px] font-medium text-[hsl(var(--destructive))] hover:underline">Revoke link</button>
                </div>}
              </div>}
            </article>
          ))}
        </div>
      </div>
      {dialog === 'create' && (
        <Modal title="Make a room" eyebrow="public / community-owned" onClose={() => setDialog(null)}>
          <form onSubmit={submitGroup} className="space-y-5">
            <div>
              <label htmlFor="group-name" className="mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Group name</label>
              <input id="group-name" name="name" required minLength={2} placeholder="e.g. Ledger After Dark" className="mt-2 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-group-name" />
            </div>
            <div>
              <label htmlFor="group-description" className="mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">What happens here?</label>
              <textarea id="group-description" name="description" rows={3} placeholder="Set the room's signal in one line." className="mt-2 w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-group-description" />
            </div>
            <button disabled={createGroup.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))] disabled:opacity-50" data-testid="button-submit-group">
              {createGroup.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4 text-[hsl(var(--secondary))]" />}
              {createGroup.isPending ? 'Making room…' : 'Create group'}
            </button>
          </form>
        </Modal>
      )}
      {notice && <Notice message={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}
    </AppShell>
  );
}

function SettingsPage() {
  const { walletAddress, disconnect } = useWallet();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 15000 } });
  const [copied, setCopied] = useState(false);
  const [privateMode, setPrivateMode] = useState(true);
  const copy = () => { navigator.clipboard?.writeText(walletAddress); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  return (
    <AppShell title="Settings" eyebrow="your identity / your rules">
      <div className="mx-auto max-w-[900px] space-y-5 p-5 md:p-8 lg:p-10">
        <div className="appear">
          <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">wallet identity</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-.07em] md:text-5xl">Keep it yours.</h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Choose the name community members see. Your XRPL wallet remains your secure account and can still be used to find you.
          </p>
        </div>

        <UsernameSettingsCard walletAddress={walletAddress} />

        <div className="grid gap-5 md:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">connected wallet</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/.45)]"><WalletCards className="size-5" /></div>
                  <div>
                    <p className="font-semibold" data-testid="text-settings-username">{shortAddress(walletAddress)}</p>
                    <p className="mono mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">XRPL mainnet</p>
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary)/.1)] px-2.5 py-1.5 text-[10px] font-medium text-[hsl(var(--primary))]" data-testid="status-wallet-connected">
                <span className="size-1.5 rounded-full bg-[hsl(var(--primary))]" /> Connected
              </span>
            </div>
            <div className="mt-7 flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-3">
              <p className="mono min-w-0 flex-1 truncate text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-full-wallet-address">{walletAddress}</p>
              <button onClick={copy} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" aria-label="Copy wallet address" data-testid="button-copy-address">
                {copied ? <Check className="size-4 text-[hsl(var(--primary))]" /> : <Copy className="size-4" />}
              </button>
            </div>
            <button onClick={disconnect} className="mt-6 flex items-center gap-2 text-xs text-[hsl(var(--destructive))] hover:underline" data-testid="button-settings-disconnect">
              <LogOut className="size-3.5" /> Disconnect this wallet
            </button>
          </section>

          <section className="rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6">
            <p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">connection health</p>
            <div className="mt-5 flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${health.isError ? 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]'}`}><Wifi className="size-4" /></div>
              <div>
                <p className="text-sm font-medium">{health.isLoading ? 'Checking signal…' : health.isError ? 'Signal interrupted' : 'All systems listening'}</p>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid="status-api-health">{health.isError ? 'The server did not answer.' : health.data?.status ?? 'XRPL relay ready'}</p>
              </div>
            </div>
            <div className="mt-5 h-px bg-[hsl(var(--border))]" />
            <div className="mt-5 flex items-start gap-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[hsl(var(--primary))]" />
              <p>Wallet sessions expire quickly. Messages remain address-to-address.</p>
            </div>
          </section>
        </div>

        <section className="rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]"><Bell className="size-4" /></div>
            <div className="flex-1">
              <h3 className="font-semibold">Privacy controls</h3>
              <p className="mt-1 max-w-xl text-sm leading-5 text-[hsl(var(--muted-foreground))]">Your username and wallet address are shown to other members; private messages remain end-to-end encrypted.</p>
              <div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4">
                <div>
                  <p className="text-sm font-medium">Private by default</p>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Only your messages reveal you are here.</p>
                </div>
                <button onClick={() => setPrivateMode((value) => !value)} className={`relative h-7 w-12 rounded-full transition ${privateMode ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground)/.28)]'}`} role="switch" aria-checked={privateMode} aria-label="Toggle private by default" data-testid="switch-private-mode">
                  <span className={`absolute top-1 size-5 rounded-full bg-[hsl(var(--card))] shadow-sm transition-transform ${privateMode ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
        </section>
        <BrowserNotificationSettings walletAddress={walletAddress} />
        <div className="flex items-center gap-2 pt-2 text-xs text-[hsl(var(--muted-foreground))]">
          <KeyRound className="size-3.5 text-[hsl(var(--secondary-foreground))]" /> Your wallet remains your account; your username is your Frogtown handle.
        </div>
      </div>
    </AppShell>
  );
}

function LockedPage({ title }: { title: string }) {
  const [location, setLocation] = useLocation();
  return <div className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-6"><div className="max-w-md text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] shadow-[4px_4px_0_hsl(var(--accent))]"><LockKeyhole className="size-6" /></div><p className="mono mt-7 text-[10px] uppercase tracking-[.2em] text-[hsl(var(--muted-foreground))]">wallet required</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.07em]">{title} starts at the door.</h1><p className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Connect with Xaman on XRPL or an EVM wallet on LadyChain to enter Frogtown.</p><button onClick={() => setLocation('/')} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-5 py-3 text-sm font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]">Connect wallet <ArrowRight className="size-4" /></button><p className="mono mt-5 text-[10px] text-[hsl(var(--muted-foreground))]">{location}</p></div></div>;
}

function HomePage() {
  const { walletAddress } = useWallet();
  const [dialog, setDialog] = useState(false);
  if (!walletAddress) return <WalletEntry />;
  return <AppShell title="Chats" eyebrow="private lines / wallet-native" onNewChat={() => setDialog(true)}><ChatWorkspace onNewChat={() => setDialog(true)} />{dialog && <DirectChatDialog onClose={() => setDialog(false)} onCreated={(id) => { setDialog(false); window.sessionStorage.setItem('swamp-selected-conversation', id); window.dispatchEvent(new CustomEvent('swamp-select-conversation', { detail: id })); }} />}</AppShell>;
}

function GroupInvitePreviewPage({
  token,
  walletAddress,
  onContinueToSignIn,
  onCancel,
  onJoin,
  isJoining,
}: {
  token: string;
  walletAddress: string | null;
  onContinueToSignIn: () => void;
  onCancel: () => void;
  onJoin: () => void;
  isJoining: boolean;
}) {
  const preview = useQuery({
    queryKey: ['group-invite-preview', token],
    queryFn: () => previewGroupInvite({ token }),
    enabled: Boolean(token),
    retry: false,
  });
  return (
    <div className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-5">
      <main className="w-full max-w-xl rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl sm:p-8" aria-labelledby="group-invite-title">
        <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">Frogtown group invite</p>
        {preview.isPending ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Checking this invite…</div>
        ) : preview.isError || !preview.data ? (
          <>
            <h1 id="group-invite-title" className="mt-3 text-3xl font-semibold tracking-[-.06em]">This invite is unavailable</h1>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{preview.error ? errorMessage(preview.error, 'This invite may have been revoked or expired.') : 'This invite may have been revoked or expired.'}</p>
            <button onClick={onCancel} className="mt-7 rounded-xl bg-[hsl(var(--foreground))] px-5 py-3 text-sm font-medium text-[hsl(var(--card))]">Close invite</button>
          </>
        ) : (
          <>
            <h1 id="group-invite-title" className="mt-3 text-3xl font-semibold tracking-[-.06em]">Preview {preview.data.name}</h1>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{preview.data.description || 'A Frogtown group chat.'}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[hsl(var(--border))] p-4"><p className="mono text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Members</p><p className="mt-2 text-lg font-semibold">{preview.data.memberCount}</p></div>
              <div className="rounded-xl border border-[hsl(var(--border))] p-4"><p className="mono text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Created by</p><p className="mt-2 truncate text-sm font-semibold">{preview.data.creatorUsername ? `@${preview.data.creatorUsername}` : shortAddress(preview.data.creatorAddress)}</p></div>
            </div>
            <p className="mt-5 rounded-xl bg-[hsl(var(--muted)/.45)] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Joining lets you receive new encrypted messages. Existing members’ devices may automatically share older encrypted history with you. Frogtown cannot read message contents.</p>
            {!walletAddress ? (
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button onClick={onContinueToSignIn} className="flex-1 rounded-xl bg-[hsl(var(--foreground))] px-5 py-3 text-sm font-medium text-[hsl(var(--card))]">Continue to wallet sign-in</button>
                <button onClick={onCancel} className="rounded-xl border border-[hsl(var(--border))] px-5 py-3 text-sm font-medium">Cancel</button>
              </div>
            ) : (
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button onClick={onJoin} disabled={isJoining} className="flex-1 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-60">{isJoining ? 'Joining…' : 'Join group'}</button>
                <button onClick={onCancel} className="rounded-xl border border-[hsl(var(--border))] px-5 py-3 text-sm font-medium">Not now</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function RouterView() {
  const { walletAddress } = useWallet();
  const [location, setLocation] = useLocation();
  const client = useQueryClient();
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('groupInvite');
    if (fromUrl) {
      window.sessionStorage.setItem('frogtown-pending-group-invite', fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem('frogtown-pending-group-invite');
  });
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [joiningInvite, setJoiningInvite] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('groupInvite');
    if (token) {
      window.sessionStorage.setItem('frogtown-pending-group-invite', token);
      setPendingInviteToken(token);
    }
  }, []);
  useEffect(() => {
    if (walletAddress) setInviteDismissed(false);
  }, [walletAddress]);
  const clearInvite = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('groupInvite');
    window.history.replaceState(window.history.state, '', url.toString());
    window.sessionStorage.removeItem('frogtown-pending-group-invite');
    setPendingInviteToken(null);
    setInviteDismissed(false);
  };
  const joinInvite = async () => {
    if (!walletAddress || !pendingInviteToken || joiningInvite) return;
    setJoiningInvite(true);
    try {
      const group = await joinGroupByInvite({ token: pendingInviteToken, walletAddress });
      clearInvite();
      await Promise.all([
        client.invalidateQueries({ queryKey: getListGroupsQueryKey({ walletAddress }) }),
        client.invalidateQueries({ queryKey: getListConversationsQueryKey({ walletAddress }) }),
      ]);
      window.sessionStorage.setItem(`swamp-selected-conversation:${walletAddress}`, group.conversationId);
      setLocation('/');
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('swamp-select-conversation', { detail: group.conversationId })), 0);
    } catch (error) {
      window.alert(errorMessage(error, 'This group invite is invalid, revoked, or your access has been removed.'));
    } finally {
      setJoiningInvite(false);
    }
  };
  useEffect(() => {
    if (!walletAddress && location !== '/') {
      window.sessionStorage.setItem('frogtown-signin-return-to', location);
    }
  }, [location, walletAddress]);
  if (pendingInviteToken && !inviteDismissed) {
    return <GroupInvitePreviewPage
      token={pendingInviteToken}
      walletAddress={walletAddress}
      onContinueToSignIn={() => setInviteDismissed(true)}
      onCancel={clearInvite}
      onJoin={() => void joinInvite()}
      isJoining={joiningInvite}
    />;
  }
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

function FreshStartBackupPrompt({
  walletAddress,
  forceVisible,
  onBackupDone,
}: {
  walletAddress: string;
  forceVisible: boolean;
  onBackupDone: () => void;
}) {
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState(forceVisible);

  useEffect(() => {
    const key = freshStartBackupKey(walletAddress);
    const syncVisibility = () => {
      try {
        setVisible(forceVisible || window.localStorage.getItem(key) === '1');
      } catch {
        setVisible(forceVisible);
      }
    };
    const handleBackupCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ walletAddress?: string }>).detail;
      if (detail?.walletAddress !== walletAddress) return;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // The in-memory prompt still closes after the browser downloads the backup.
      }
      setVisible(false);
      onBackupDone();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) syncVisibility();
    };

    syncVisibility();
    window.addEventListener(BACKUP_CREATED_EVENT, handleBackupCreated);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BACKUP_CREATED_EVENT, handleBackupCreated);
      window.removeEventListener('storage', onStorage);
    };
  }, [walletAddress, forceVisible, onBackupDone]);

  if (!visible) return null;
  return (
    <aside
      className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--secondary-foreground)/.15)] bg-[hsl(var(--secondary)/.96)] px-4 py-3 text-[hsl(var(--secondary-foreground))] shadow-sm backdrop-blur md:px-6"
      role="status"
      data-testid="prompt-fresh-start-backup"
    >
      <div className="flex min-w-[220px] flex-1 items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-xs font-semibold">Save a backup for your new key</p>
          <p className="mt-0.5 text-[11px] leading-4 opacity-80">
            Create and download an encrypted recovery file so you can restore your new chats on another device.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setLocation('/settings/recovery')}
          className="rounded-lg bg-[hsl(var(--secondary-foreground))] px-3 py-2 text-[11px] font-semibold text-[hsl(var(--secondary))] hover:opacity-90"
          data-testid="button-create-fresh-start-backup"
        >
          Create backup
        </button>
        <button
          onClick={() => setVisible(false)}
          className="rounded-lg px-2.5 py-2 text-[11px] font-medium hover:bg-[hsl(var(--secondary-foreground)/.08)]"
          aria-label="Remind me about the backup later"
          data-testid="button-dismiss-fresh-start-backup"
        >
          Later
        </button>
      </div>
    </aside>
  );
}

function KeyBootstrapGate({ children }: { children: ReactNode }) {
  const { walletAddress, disconnect } = useWallet();
  const client = useQueryClient();
  const resetBusyRef = useRef(false);
  const ownResetEventUntilRef = useRef(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [canStartFresh, setCanStartFresh] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [freshStartPromptNow, setFreshStartPromptNow] = useState(false);
  const [cleanupRequired, setCleanupRequired] = useState(false);

  const clearResetLocalState = (targetWallet: string) => {
    try {
      clearPendingEncryptedMessages(targetWallet);
    } finally {
      try {
        window.sessionStorage.removeItem(`swamp-selected-conversation:${targetWallet}`);
      } catch {
        // Conversation selection is only a local preference.
      }
      client.clear();
    }
  };

  useEffect(() => {
    setFreshStartPromptNow(false);
    setCleanupRequired(false);
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      setStatus('idle');
      setError('');
      setCanStartFresh(false);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError('');
    setCanStartFresh(false);
    void ensureIdentityKey(walletAddress).then(() => {
      if (!cancelled) setStatus('ready');
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(errorMessage(cause, 'Could not initialize this device’s encryption key.'));
        setCanStartFresh(cause instanceof IdentityKeyRecoveryRequiredError);
        setStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [walletAddress, attempt]);

  useEffect(() => {
    if (!walletAddress) return;
    let pendingServerResetTimer: number | null = null;
    const cancelPendingServerReset = () => {
      if (pendingServerResetTimer !== null) {
        window.clearTimeout(pendingServerResetTimer);
        pendingServerResetTimer = null;
      }
    };
    const applyRemoteReset = (targetWallet: string | undefined) => {
      if (targetWallet !== walletAddress || resetBusyRef.current) return;
      try {
        clearResetLocalState(walletAddress);
      } catch {
        setCleanupRequired(true);
        setCanStartFresh(false);
        setError('Frogtown detected a key reset but could not clear this tab’s encrypted retry record. Chats are paused until cleanup succeeds.');
        setStatus('error');
        return;
      }
      setCleanupRequired(false);
      setCanStartFresh(false);
      setError('');
      setStatus('loading');
      setAttempt((value) => value + 1);
    };
    const onWindowReset = (event: Event) => {
      const detail = (event as CustomEvent<{ walletAddress?: string; source?: string }>).detail;
      if (detail?.source === 'server' && detail.walletAddress === walletAddress) {
        if (Date.now() < ownResetEventUntilRef.current) {
          ownResetEventUntilRef.current = 0;
          return;
        }
        cancelPendingServerReset();
        pendingServerResetTimer = window.setTimeout(() => {
          pendingServerResetTimer = null;
          applyRemoteReset(detail.walletAddress);
        }, 400);
        return;
      }
      cancelPendingServerReset();
      applyRemoteReset(detail?.walletAddress);
    };
    const onKeyCheck = () => {
      if (resetBusyRef.current || status !== 'ready') return;
      void ensureIdentityKey(walletAddress).catch((cause: unknown) => {
        if (!(cause instanceof IdentityKeyRecoveryRequiredError)) return;
        try {
          clearResetLocalState(walletAddress);
        } catch {
          setCleanupRequired(true);
          setError('This wallet’s encryption key changed, but Frogtown could not clear this tab’s encrypted retry record. Chats are paused until cleanup succeeds.');
          setCanStartFresh(false);
          setStatus('error');
          return;
        }
        setCleanupRequired(false);
        setError(errorMessage(cause, 'This device’s encryption key changed. Restore its current backup to continue.'));
        setCanStartFresh(true);
        setStatus('error');
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ENCRYPTION_RESET_STORAGE_KEY || !event.newValue) return;
      try {
        const notice = JSON.parse(event.newValue) as { walletAddress?: string };
        cancelPendingServerReset();
        applyRemoteReset(notice.walletAddress);
      } catch {
        // Ignore malformed cross-tab notices; key checks also run on visibility and reconnect.
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(ENCRYPTION_RESET_CHANNEL);
        channel.onmessage = (event: MessageEvent<{ walletAddress?: string }>) => {
          cancelPendingServerReset();
          applyRemoteReset(event.data?.walletAddress);
        };
      } catch {
        // The storage-event fallback remains available.
      }
    }
    window.addEventListener(WALLET_ENCRYPTION_RESET_EVENT, onWindowReset);
    window.addEventListener(ENCRYPTION_KEY_CHECK_EVENT, onKeyCheck);
    window.addEventListener('storage', onStorage);
    const keyCheckInterval = window.setInterval(onKeyCheck, 30_000);
    return () => {
      channel?.close();
      cancelPendingServerReset();
      window.clearInterval(keyCheckInterval);
      window.removeEventListener(WALLET_ENCRYPTION_RESET_EVENT, onWindowReset);
      window.removeEventListener(ENCRYPTION_KEY_CHECK_EVENT, onKeyCheck);
      window.removeEventListener('storage', onStorage);
    };
  }, [walletAddress, client, status]);

  const startFresh = async () => {
    const confirmed = window.confirm(
      'This creates a new encryption key and permanently hides this wallet’s existing chat history. You will stay in your groups, but old messages will not be restored. Other members’ messages are not deleted. Continue?',
    );
    if (!confirmed) return;
    resetBusyRef.current = true;
    ownResetEventUntilRef.current = Date.now() + 5_000;
    setResetBusy(true);
    setError('');
    try {
      await resetIdentityKey(walletAddress);
      try {
        window.localStorage.setItem(freshStartBackupKey(walletAddress), '1');
      } catch {
        // Keep the prompt visible for this session even if persistent browser storage is unavailable.
      }
      broadcastEncryptionReset(walletAddress);
      setFreshStartPromptNow(true);
      setCanStartFresh(false);
      try {
        clearResetLocalState(walletAddress);
      } catch {
        setCleanupRequired(true);
        setStatus('error');
        setError('The new key is active, but Frogtown could not clear this tab’s encrypted retry record. Chats are paused until cleanup succeeds.');
        return;
      }
      setCleanupRequired(false);
      setStatus('loading');
      setAttempt((value) => value + 1);
    } catch (cause) {
      ownResetEventUntilRef.current = 0;
      setError(errorMessage(cause, 'Could not reset this wallet’s encrypted chat history.'));
    } finally {
      resetBusyRef.current = false;
      setResetBusy(false);
    }
  };
  const retryEncryptionSetup = () => {
    if (!cleanupRequired) {
      setAttempt((value) => value + 1);
      return;
    }
    try {
      clearResetLocalState(walletAddress);
      setCleanupRequired(false);
      setError('');
      setStatus('loading');
      setAttempt((value) => value + 1);
    } catch {
      setError('Frogtown still cannot clear this tab’s encrypted retry record. Chats remain paused; try again after browser storage is available.');
    }
  };
  const acknowledgeFreshBackup = useCallback(() => setFreshStartPromptNow(false), []);

  if (!walletAddress) return <>{children}</>;
  if (status === 'ready') {
    return (
      <>
        <FreshStartBackupPrompt
          walletAddress={walletAddress}
          forceVisible={freshStartPromptNow}
          onBackupDone={acknowledgeFreshBackup}
        />
        {children}
      </>
    );
  }
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
              <button onClick={retryEncryptionSetup} className="rounded-xl bg-[hsl(var(--foreground))] px-4 py-3 text-sm font-medium text-[hsl(var(--card))] hover:bg-[hsl(var(--primary))]" data-testid="button-retry-encryption-setup">{cleanupRequired ? 'Clear retry data and continue' : 'Try again'}</button>
              <button onClick={disconnect} className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-medium hover:bg-[hsl(var(--muted))]" data-testid="button-disconnect-encryption-setup">Disconnect</button>
            </div>
            <div className="mt-5">
              <EncryptionRecoveryPanel
                walletAddress={walletAddress}
                restoreOnly
                onRestored={() => {
                  try {
                    clearResetLocalState(walletAddress);
                  } catch {
                    setCleanupRequired(true);
                    setCanStartFresh(false);
                    setError('The backup restored, but Frogtown could not clear this tab’s encrypted retry record. Chats are paused until cleanup succeeds.');
                    setStatus('error');
                    return;
                  }
                  setCleanupRequired(false);
                  setStatus('loading');
                  setAttempt((value) => value + 1);
                }}
              />
            </div>
            {canStartFresh && (
              <section className="mt-4 rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.06)] p-4" data-testid="panel-forget-encryption-backup">
                <h2 className="text-sm font-semibold">No backup? Start with fresh chats</h2>
                <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                  This replaces the wallet’s encryption key and clears its old private chats and message history. You’ll remain in your groups, but previous encrypted messages won’t be available. Messages are not deleted for other participants. If another device reset this wallet, wait for its new backup before starting fresh here.
                </p>
                <button
                  onClick={() => void startFresh()}
                  disabled={resetBusy}
                  className="mt-3 rounded-lg border border-[hsl(var(--destructive)/.35)] px-3 py-2 text-xs font-medium text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.1)] disabled:opacity-50"
                  data-testid="button-forget-encryption-backup"
                >
                  {resetBusy ? 'Resetting encrypted chats…' : 'Forget backup and clear my chats'}
                </button>
              </section>
            )}
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

  const setWalletAddress = useCallback((address: string) => {
    setWalletAddressState(address);
    window.localStorage.setItem('swamp-wallet-address', address);
  }, []);
  const logout = logoutWallet.mutate;
  const disconnect = useCallback(() => {
    queryClient.clear();
    logout(undefined, { onSettled: () => queryClient.clear() });
    setWalletAddressState('');
    window.localStorage.removeItem('swamp-wallet-address');
    setAuthReady(true);
  }, [logout]);

  useEffect(() => {
    const onWalletStorage = (event: StorageEvent) => {
      if (event.key !== 'swamp-wallet-address') return;
      queryClient.clear();
      setWalletAddressState(event.newValue ?? '');
      setAuthReady(true);
    };
    window.addEventListener('storage', onWalletStorage);
    return () => window.removeEventListener('storage', onWalletStorage);
  }, []);

  if (!authReady) {
    return <div className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-6"><div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-5 py-4 text-sm text-[hsl(var(--muted-foreground))] shadow-lg"><RefreshCw className="size-4 animate-spin text-[hsl(var(--primary))]" /> Checking wallet session…</div></div>;
  }

  return (
    <WalletContext.Provider value={{ walletAddress, setWalletAddress, disconnect }}>
      <LadyChainSessionSync
        walletAddress={walletAddress}
        setWalletAddress={setWalletAddress}
        disconnect={disconnect}
      />
      <WouterRouter key={walletAddress || 'anonymous'} base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ErrorBoundary resetKey={window.location.pathname}>
          <MobileAuthApprovalGate walletAddress={walletAddress} onChangeWallet={disconnect}>
          <KeyBootstrapGate>
            <UsernameOnboardingGate walletAddress={walletAddress}>
              <RealtimeBridge><RouterView /></RealtimeBridge>
            </UsernameOnboardingGate>
          </KeyBootstrapGate>
          </MobileAuthApprovalGate>
        </ErrorBoundary>
      </WouterRouter>
    </WalletContext.Provider>
  );
}

function App() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const referrerAddress = url.searchParams.get('ref');
    if (referrerAddress && (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(referrerAddress) || /^0x[a-fA-F0-9]{40}$/.test(referrerAddress))) {
      window.sessionStorage.setItem('frogtown-referrer-wallet', referrerAddress.startsWith('0x') ? referrerAddress.toLowerCase() : referrerAddress);
      url.searchParams.delete('ref');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, []);
  return <QueryClientProvider client={queryClient}><AuthGate /></QueryClientProvider>;
}

export default App;