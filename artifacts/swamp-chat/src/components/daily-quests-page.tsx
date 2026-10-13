import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coins,
  Crown,
  Flame,
  Leaf,
  LoaderCircle,
  MessageCircle,
  RotateCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetGamificationLeaderboardQueryKey,
  getGetGamificationHistoryQueryKey,
  getGetGamificationSummaryQueryKey,
  useCheckInGamification,
  useGetGamificationHistory,
  useGetGamificationLeaderboard,
  useGetGamificationSummary,
  usePlayGamificationCoinFlip,
  type GetGamificationHistoryQueryResult,
} from '@workspace/api-client-react';
import { HermitTick } from '@/components/hermit-tick';

type DailyQuestsPageProps = { walletAddress?: string };
type FlipChoice = 'heads' | 'tails';
type HistoryItem = GetGamificationHistoryQueryResult['items'][number];

const QUEST_COPY = {
  check_in: {
    title: 'Check in',
    description: 'Drop by Frogtown and keep your streak going.',
    icon: CalendarDays,
    action: 'Check in',
  },
  ledger_minute: {
    title: 'Post to the timeline',
    description: 'Share a thought with the neighborhood.',
    icon: Send,
    action: 'Write a post',
  },
  community_engagement: {
    title: 'Show up for someone',
    description: 'Like and comment on another member’s post.',
    icon: MessageCircle,
    action: 'Visit timeline',
  },
  room_spotlight: {
    title: 'Say hello in a room',
    description: 'Send a message in any community room.',
    icon: Users,
    action: 'Find a room',
  },
} as const;

function shortWallet(address: string) {
  if (address.length < 18) return address;
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

function utcUntilReset() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const seconds = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function FrogSeal({ earned = false, small = false }: { earned?: boolean; small?: boolean }) {
  return (
    <div className={`frog-seal relative flex shrink-0 items-center justify-center rounded-full ${small ? 'size-10' : 'size-[84px]'} ${earned ? 'frog-seal-earned' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 88 88" className={`${small ? 'size-8' : 'size-[68px]'}`} fill="none">
        <path d="M15 43c0-5.5 4.5-10 10-10 1.8 0 3.5.5 5 1.3 3.8-2.5 8.5-4 14-4s10.2 1.5 14 4a10 10 0 1 1 15 8.7c0 14.1-12.1 25.5-29 25.5S15 57.1 15 43Z" fill={earned ? '#f6fbef' : '#d9edc8'} stroke="#214a32" strokeWidth="3"/>
        <circle cx="29" cy="26" r="9" fill="#f6fbef" stroke="#214a32" strokeWidth="3"/>
        <circle cx="59" cy="26" r="9" fill="#f6fbef" stroke="#214a32" strokeWidth="3"/>
        <circle cx="30" cy="26" r="3" fill="#214a32"/>
        <circle cx="58" cy="26" r="3" fill="#214a32"/>
        <path d="M34 50c3.2 3.4 6.5 5 10 5s6.8-1.6 10-5" stroke="#214a32" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      {earned && <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full border-2 border-[hsl(var(--card))] bg-[hsl(var(--accent))] text-white"><Check className="size-3" /></span>}
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="space-y-3" aria-label="Loading daily quests" data-testid="loading-daily-quests">
      <div className="h-44 animate-pulse rounded-[1.5rem] bg-[hsl(var(--muted))]" />
      <div className="h-72 animate-pulse rounded-[1.5rem] bg-[hsl(var(--muted))]" />
    </div>
  );
}

export function DailyQuestsPage({ walletAddress }: DailyQuestsPageProps) {
  const client = useQueryClient();
  const summaryQuery = useGetGamificationSummary({
    query: { queryKey: getGetGamificationSummaryQueryKey(), refetchInterval: 30_000 },
  });
  const leaderboardQuery = useGetGamificationLeaderboard({
    query: { queryKey: getGetGamificationLeaderboardQueryKey(), refetchInterval: 30_000 },
  });
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const historyParams = { cursor: historyCursor, limit: 20 };
  const historyQuery = useGetGamificationHistory(historyParams, {
    query: {
      enabled: Boolean(walletAddress),
      queryKey: [...getGetGamificationHistoryQueryKey(historyParams), walletAddress ?? 'anonymous'],
    },
  });
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const checkIn = useCheckInGamification();
  const flip = usePlayGamificationCoinFlip();
  const [choice, setChoice] = useState<FlipChoice>('heads');
  const [resetClock, setResetClock] = useState(utcUntilReset());
  const [checkInError, setCheckInError] = useState('');
  const [flipError, setFlipError] = useState('');
  const [lastFlip, setLastFlip] = useState<Awaited<ReturnType<typeof flip.mutateAsync>> | null>(null);
  const pendingFlip = useRef<{ requestId: string; choice: FlipChoice } | null>(null);

  useEffect(() => {
    setHistoryCursor(undefined);
    setHistoryItems([]);
  }, [walletAddress]);

  useEffect(() => {
    if (!historyQuery.data) return;
    setHistoryItems((current) => {
      const seen = new Set(current.map((item) => item.id));
      const incoming = historyQuery.data.items.filter((item) => !seen.has(item.id));
      return historyCursor ? [...current, ...incoming] : [...incoming, ...current];
    });
  }, [historyQuery.data, historyCursor]);

  useEffect(() => {
    const timer = window.setInterval(() => setResetClock(utcUntilReset()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = summaryQuery.data;
  const balance = summary?.points ?? 0;
  const tasks = summary?.tasks ?? [];
  const doneCount = tasks.filter((task) => task.completed).length;
  const badgeProgress = Math.min(100, Math.max(0, balance));
  const badgeRemaining = Math.max(0, 100 - balance);

  const onCheckIn = () => {
    setCheckInError('');
    checkIn.mutate(undefined, {
      onSuccess: () => {
        setHistoryCursor(undefined);
        setHistoryItems([]);
        void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
        void client.invalidateQueries({ queryKey: getGetGamificationHistoryQueryKey() });
      },
      onError: (error) => setCheckInError(error instanceof Error ? error.message : 'Check-in could not be saved. Try again.'),
    });
  };

  const onFlip = () => {
    if ((balance < 1 && !pendingFlip.current) || flip.isPending) return;
    setFlipError('');
    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const value = Math.floor(Math.random() * 16);
        return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
      });
    const attempt = pendingFlip.current ?? { requestId, choice };
    pendingFlip.current = attempt;
    flip.mutate({ data: attempt }, {
      onSuccess: (result) => {
        pendingFlip.current = null;
        setLastFlip(result);
        setHistoryCursor(undefined);
        setHistoryItems([]);
        void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
        void client.invalidateQueries({ queryKey: getGetGamificationHistoryQueryKey() });
      },
      onError: (error) => setFlipError(error instanceof Error
        ? `${error.message} Retrying is safe; Frogtown reuses this flip request.`
        : 'The flip could not be confirmed. Retrying is safe; Frogtown reuses this flip request.'),
    });
  };

  if (summaryQuery.isLoading) {
    return <div className="min-h-full px-4 pb-12 pt-6 sm:px-6 md:px-8 md:pt-8"><div className="mx-auto max-w-[1120px]"><SkeletonPanel /></div></div>;
  }

  if (summaryQuery.isError || !summary) {
    return (
      <div className="min-h-full px-4 pb-12 pt-6 sm:px-6 md:px-8 md:pt-8" data-testid="page-daily-quests">
        <section className="mx-auto max-w-[760px] rounded-[1.5rem] border border-[hsl(var(--destructive)/.22)] bg-[hsl(var(--card))] p-8 text-center" role="alert" data-testid="error-daily-quests">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]"><CircleAlert className="size-5" /></div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">The marsh is a little quiet.</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">Daily quest details couldn’t be reached. Give it another try in a moment.</p>
          <button type="button" onClick={() => void summaryQuery.refetch()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))]" data-testid="button-retry-daily-quests"><RotateCw className="size-4" /> Try again</button>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 pb-12 pt-6 sm:px-6 md:px-8 md:pt-8" data-testid="page-daily-quests">
      <div className="mx-auto max-w-[1120px]">
        <header className="appear mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono flex items-center gap-2 text-[10px] uppercase tracking-[.2em] text-[hsl(var(--primary))]" data-testid="text-quests-eyebrow"><span className="size-1.5 rounded-full bg-[hsl(var(--primary))] pulse-dot" /> The neighborhood / daily rituals</p>
            <h1 className="mt-2 text-[2.35rem] font-semibold leading-none tracking-[-.075em] sm:text-5xl" data-testid="text-quests-title">A little good<br className="sm:hidden" /> every day.</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] px-3.5 py-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid="status-quest-reset">
            <Clock3 className="size-3.5 text-[hsl(var(--primary))]" />
            <span>Daily reset in</span>
            <span className="mono font-medium tabular-nums text-[hsl(var(--foreground))]">{resetClock}</span>
            <span className="mono text-[9px] uppercase tracking-wider">UTC</span>
          </div>
        </header>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.8fr)] lg:gap-6">
          <main className="min-w-0 space-y-5">
            <section className="quests-hero relative overflow-hidden rounded-[1.6rem] border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))] shadow-[0_18px_42px_hsl(155_27%_15%/.11)] sm:p-7" data-testid="panel-quest-summary">
              <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full border border-[hsl(var(--sidebar-accent)/.15)]" />
              <div className="pointer-events-none absolute -right-4 top-2 size-32 rounded-full border border-[hsl(var(--sidebar-accent)/.14)]" />
              <div className="relative flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.5)]">Your Frogtown pocket</p>
                  <div className="mt-4 flex items-end gap-3">
                    <span className="text-6xl font-semibold leading-[.85] tracking-[-.085em] sm:text-7xl" data-testid="text-points-balance">{balance.toLocaleString()}</span>
                    <span className="mono pb-1 text-[10px] uppercase tracking-[.17em] text-[hsl(var(--sidebar-foreground)/.55)]">game points</span>
                  </div>
                  <p className="mt-4 max-w-sm text-sm leading-6 text-[hsl(var(--sidebar-foreground)/.64)]">A small tally for showing up. Points stay here: they can’t be transferred or cashed out.</p>
                </div>
                <div className="flex min-w-[176px] items-center gap-3 rounded-2xl border border-[hsl(var(--sidebar-foreground)/.12)] bg-[hsl(var(--sidebar-foreground)/.055)] px-4 py-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--sidebar-accent)/.15)] text-[hsl(var(--sidebar-accent))]"><Flame className="size-5" /></div>
                  <div><p className="mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.5)]">Current streak</p><p className="mt-0.5 text-xl font-semibold tracking-tight" data-testid="text-current-streak">{summary.currentStreak}<span className="ml-1 text-xs font-normal text-[hsl(var(--sidebar-foreground)/.55)]">days</span></p></div>
                </div>
              </div>
              <div className="relative mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[hsl(var(--sidebar-foreground)/.12)] pt-4">
                <span className="mono text-[9px] uppercase tracking-[.15em] text-[hsl(var(--sidebar-foreground)/.42)]">Today’s lap</span>
                <div className="flex items-center gap-2" aria-label={`${doneCount} of 4 quests complete`} data-testid="text-quest-progress">
                  {[0, 1, 2, 3].map((item) => <span key={item} className={`h-1.5 w-9 rounded-full transition-colors duration-300 ${item < doneCount ? 'bg-[hsl(var(--sidebar-accent))]' : 'bg-[hsl(var(--sidebar-foreground)/.17)]'}`} />)}
                </div>
                <span className="text-xs text-[hsl(var(--sidebar-foreground)/.68)]">{doneCount} of 4 done</span>
                <span className="mono ml-auto text-[10px] text-[hsl(var(--sidebar-foreground)/.45)]">best streak <strong className="font-medium text-[hsl(var(--sidebar-foreground)/.8)]">{summary.longestStreak}</strong></span>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.78)] p-4 shadow-[0_10px_30px_hsl(155_27%_15%/.035)] sm:p-5" data-testid="panel-daily-quests">
              <div className="mb-4 flex items-center justify-between gap-3 px-1">
                <div><p className="mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Small things, good neighbors</p><h2 className="mt-1 text-lg font-semibold tracking-[-.04em]">Today’s quests</h2></div>
                <span className="rounded-full bg-[hsl(var(--primary)/.08)] px-2.5 py-1 text-[10px] font-medium text-[hsl(var(--primary))]">1 point each</span>
              </div>
              <div className="space-y-2">
                {tasks.map((task) => {
                  const copy = QUEST_COPY[task.id];
                  if (!copy) return null;
                  const Icon = copy.icon;
                  const isCheckIn = task.id === 'check_in';
                  const progress = Math.min(task.target, Math.max(0, task.progress));
                  return (
                    <article key={task.id} className={`quest-row group flex flex-wrap items-center gap-3 rounded-[1.1rem] border p-3.5 transition duration-200 sm:flex-nowrap sm:gap-4 sm:p-4 ${task.completed ? 'border-[hsl(var(--primary)/.18)] bg-[hsl(var(--primary)/.035)]' : 'border-[hsl(var(--border)/.82)] bg-[hsl(var(--background)/.5)] hover:border-[hsl(var(--primary)/.28)] hover:bg-[hsl(var(--card))]'}`} data-testid={`quest-${task.id}`}>
                      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition ${task.completed ? 'bg-[hsl(var(--primary)/.13)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{task.completed ? <Check className="size-[18px]" /> : <Icon className="size-[18px]" />}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium tracking-tight">{copy.title}</h3>{task.completed && <span className="rounded-full bg-[hsl(var(--primary)/.1)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[hsl(var(--primary))]">Done</span>}</div>
                        <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{copy.description}</p>
                        {task.target > 1 && !task.completed && <p className="mono mt-1.5 text-[9px] text-[hsl(var(--muted-foreground)/.8)]">{progress} / {task.target} steps</p>}
                      </div>
                      {isCheckIn ? (
                        <button type="button" onClick={onCheckIn} disabled={task.completed || checkIn.isPending} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-medium transition ${task.completed ? 'cursor-default border border-[hsl(var(--primary)/.2)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--foreground))] text-[hsl(var(--card))] hover:-translate-y-0.5 hover:bg-[hsl(var(--primary))] disabled:cursor-wait disabled:opacity-60'}`} data-testid="button-daily-check-in">{checkIn.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : task.completed ? <Check className="size-3.5" /> : <ArrowRight className="size-3.5" />}{checkIn.isPending ? 'Saving' : task.completed ? 'Checked in' : copy.action}</button>
                      ) : !task.completed ? (
                        <Link href={task.id === 'room_spotlight' ? '/groups' : '/timeline'} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.07)]" data-testid={`link-quest-${task.id}`}>{copy.action}<ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></Link>
                      ) : (
                        <span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">+1 point</span>
                      )}
                    </article>
                  );
                })}
                {tasks.length === 0 && <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-7 text-center" data-testid="empty-quests"><Leaf className="mx-auto size-5 text-[hsl(var(--primary))]" /><p className="mt-2 text-sm font-medium">Nothing to do just yet.</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Quest details will show up here when they’re ready.</p></div>}
              </div>
              {checkInError && <p className="mt-3 flex items-start gap-2 rounded-lg bg-[hsl(var(--destructive)/.07)] px-3 py-2.5 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid="error-check-in"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{checkInError}</p>}
            </section>

            <section className="grid grid-cols-1 gap-5 sm:grid-cols-[.92fr_1.08fr]">
              <article className="relative overflow-hidden rounded-[1.45rem] border border-[hsl(var(--primary)/.19)] bg-[hsl(var(--secondary)/.38)] p-5" data-testid="panel-frog-badge">
                <div className="absolute -right-6 -top-10 size-32 rounded-full border border-[hsl(var(--primary)/.1)]" />
                <div className="relative flex items-center gap-3"><FrogSeal earned={summary.frogBadgeEarned} small /><div><p className="mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Permanent keepsake</p><h2 className="mt-1 text-base font-semibold tracking-tight">Frog badge</h2></div></div>
                {summary.frogBadgeEarned ? (
                  <div className="relative mt-4 rounded-xl border border-[hsl(var(--primary)/.16)] bg-[hsl(var(--card)/.55)] p-3"><p className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--primary))]"><BadgeCheck className="size-4" /> Earned — yours to keep</p><p className="mt-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">{summary.frogBadgeEarnedAt ? `First earned ${new Date(summary.frogBadgeEarnedAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Earned once your balance reached 100 points.'}</p></div>
                ) : (
                  <div className="relative mt-4"><div className="flex items-center justify-between text-[10px]"><span className="text-[hsl(var(--muted-foreground))]">Toward your first 100</span><span className="mono font-medium">{badgeProgress} / 100</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--card)/.8)]"><div className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500" style={{ width: `${badgeProgress}%` }} /></div><p className="mt-2 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">{badgeRemaining} more points to earn the permanent badge. It’s game-only, not an asset.</p></div>
                )}
              </article>

              <article className="coin-panel relative overflow-hidden rounded-[1.45rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.83)] p-5" data-testid="panel-coin-flip">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Just for the fun of it</p><h2 className="mt-1 text-base font-semibold tracking-tight">Coin flip</h2></div>
                  <div className="flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--accent)/.13)] text-[hsl(var(--accent))]"><Coins className="size-[18px]" /></div>
                </div>
                <div className="mt-4 flex items-center gap-2" role="group" aria-label="Choose your coin side">
                  {(['heads', 'tails'] as const).map((side) => <button type="button" key={side} onClick={() => setChoice(side)} disabled={flip.isPending || Boolean(pendingFlip.current)} aria-pressed={(pendingFlip.current?.choice ?? choice) === side} className={`min-h-9 flex-1 rounded-lg border px-3 text-xs font-medium capitalize transition ${((pendingFlip.current?.choice ?? choice) === side) ? 'border-[hsl(var(--primary)/.38)] bg-[hsl(var(--primary)/.09)] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/.55)]'} disabled:opacity-50`} data-testid={`button-choice-${side}`}>{side}</button>)}
                </div>
                <button type="button" onClick={onFlip} disabled={flip.isPending || (balance < 1 && !pendingFlip.current)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 text-xs font-medium text-[hsl(var(--card))] transition hover:-translate-y-0.5 hover:bg-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-play-coin-flip">
                  {flip.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {flip.isPending ? 'Waiting on the ledger…' : pendingFlip.current ? 'Retry the same flip' : balance < 1 ? 'Need 1 point to play' : 'Flip for 1 point'}
                </button>
                <p className="mt-2 text-center text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">Win: 1.80 points back, 0.80 net. Lose: the 1 point stake.</p>
                {balance < 1 && <p className="mt-2 rounded-lg bg-[hsl(var(--accent)/.07)] px-3 py-2 text-center text-[10px] text-[hsl(var(--accent))]" data-testid="status-insufficient-points">Your pocket is empty. Complete a quest to play.</p>}
                {flipError && <p className="mt-2 flex items-start gap-2 rounded-lg bg-[hsl(var(--destructive)/.07)] px-3 py-2 text-[10px] text-[hsl(var(--destructive))]" role="alert" data-testid="error-coin-flip"><CircleAlert className="mt-0.5 size-3 shrink-0" />{flipError}</p>}
                {lastFlip && (
                  <div className={`mt-3 flex items-start gap-2.5 rounded-xl border p-3 ${lastFlip.won ? 'border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.055)]' : 'border-[hsl(var(--accent)/.2)] bg-[hsl(var(--accent)/.055)]'}`} aria-live="polite" data-testid="result-coin-flip">
                    <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${lastFlip.won ? 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]'}`}>{lastFlip.won ? <Trophy className="size-3.5" /> : <RotateCw className="size-3.5" />}</div>
                    <div className="min-w-0"><p className="text-xs font-semibold">{lastFlip.won ? 'Nice call.' : 'Not this time.'} It landed {lastFlip.result}.</p><p className="mt-1 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">{lastFlip.netChangePoints > 0 ? '+' : ''}{lastFlip.netChangePoints} point net · balance now {lastFlip.points}</p></div>
                  </div>
                )}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-[hsl(var(--muted-foreground)/.8)]"><ShieldCheck className="size-3" /> The server resolves every flip. Points are game-only.</p>
              </article>
            </section>
          </main>

          <aside className="min-w-0 space-y-5">
            <section className="overflow-hidden rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.82)] shadow-[0_10px_30px_hsl(155_27%_15%/.035)]" data-testid="panel-leaderboard">
              <div className="border-b border-[hsl(var(--border)/.75)] px-5 py-4">
                <div className="flex items-center justify-between gap-2"><div><p className="mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Around the pond</p><h2 className="mt-1 text-lg font-semibold tracking-[-.04em]">Top ten</h2></div><div className="flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.09)] text-[hsl(var(--primary))]"><Trophy className="size-[17px]" /></div></div>
                <p className="mt-2 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">Ranked by current game-point balance.</p>
              </div>
              {leaderboardQuery.isLoading ? (
                <div className="space-y-3 p-5" aria-label="Loading leaderboard" data-testid="loading-leaderboard">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="flex animate-pulse items-center gap-3"><div className="size-7 rounded-lg bg-[hsl(var(--muted))]" /><div className="h-3 flex-1 rounded bg-[hsl(var(--muted))]" /><div className="h-3 w-10 rounded bg-[hsl(var(--muted))]" /></div>)}</div>
              ) : leaderboardQuery.isError ? (
                <div className="p-5 text-center" role="alert" data-testid="error-leaderboard"><p className="text-xs text-[hsl(var(--muted-foreground))]">The standings couldn’t be loaded.</p><button type="button" onClick={() => void leaderboardQuery.refetch()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid="button-retry-leaderboard"><RotateCw className="size-3" /> Try again</button></div>
              ) : !leaderboardQuery.data?.items?.length ? (
                <div className="px-5 py-9 text-center" data-testid="empty-leaderboard"><div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Users className="size-4" /></div><p className="mt-3 text-sm font-medium">First footprints welcome.</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">There are no standings to show yet.</p></div>
              ) : (
                <ol className="divide-y divide-[hsl(var(--border)/.65)]" data-testid="list-leaderboard">
                  {leaderboardQuery.data.items.slice(0, 10).map((entry) => {
                    const mine = Boolean(walletAddress && walletAddress === entry.walletAddress);
                    return <li key={`${entry.rank}-${entry.walletAddress}`} className={`flex items-center gap-3 px-5 py-3 ${mine ? 'bg-[hsl(var(--primary)/.055)]' : ''}`} data-testid={`row-leaderboard-${entry.rank}`}>
                      <span className={`mono flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] ${entry.rank === 1 ? 'bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{entry.rank === 1 ? <Crown className="size-3.5" /> : String(entry.rank).padStart(2, '0')}</span>
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="mono truncate text-[11px] font-medium" title={entry.walletAddress} data-testid={`text-leaderboard-wallet-${entry.rank}`}>{shortWallet(entry.walletAddress)}</span><HermitTick walletAddress={entry.walletAddress} className="size-3.5" />{mine && <span className="rounded-full bg-[hsl(var(--primary)/.11)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">you</span>}{entry.frogBadgeEarned && <BadgeCheck className="size-3.5 shrink-0 text-[hsl(var(--primary))]" aria-label="Frog badge earned" />}</div><p className="mt-0.5 text-[9px] text-[hsl(var(--muted-foreground))]">{entry.currentStreak} day streak</p></div>
                      <span className="mono text-xs font-semibold tabular-nums" data-testid={`text-leaderboard-points-${entry.rank}`}>{entry.points.toLocaleString()}</span>
                    </li>;
                  })}
                </ol>
              )}
              <div className="border-t border-[hsl(var(--border)/.75)] px-5 py-3"><p className="text-[9px] leading-4 text-[hsl(var(--muted-foreground))]">A friendly tally, not a token market. Balances are never transferable or cashable.</p></div>
            </section>

            <section className="relative overflow-hidden rounded-[1.45rem] border border-[hsl(var(--primary)/.17)] bg-[hsl(var(--primary)/.055)] p-5" data-testid="panel-quest-howto">
              <div className="absolute -right-8 -top-8 size-24 rounded-full border border-[hsl(var(--primary)/.12)]" />
              <p className="mono relative text-[9px] uppercase tracking-[.17em] text-[hsl(var(--primary))]">How today works</p>
              <ul className="relative mt-3 space-y-2.5 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">
                <li className="flex gap-2"><span className="mono text-[hsl(var(--primary))]">01</span><span>Four little quests; one game point each.</span></li>
                <li className="flex gap-2"><span className="mono text-[hsl(var(--primary))]">02</span><span>Check in once per UTC day to grow your streak.</span></li>
                <li className="flex gap-2"><span className="mono text-[hsl(var(--primary))]">03</span><span>Your Frog badge is permanent at 100 points.</span></li>
              </ul>
              <div className="relative mt-4 border-t border-[hsl(var(--primary)/.13)] pt-3"><p className="text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">Timeline love must go to someone else. Self-likes and self-comments don’t count.</p><Link href="/timeline" className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--primary))] transition hover:gap-2.5" data-testid="link-quest-timeline">Visit the timeline <ArrowRight className="size-3.5" /></Link></div>
            </section>

            <div className="flex items-center justify-between gap-2 px-1 text-[9px] text-[hsl(var(--muted-foreground)/.75)]"><span>Daily tally · UTC day {summary.dayKey}</span>{leaderboardQuery.isFetching && <span className="inline-flex items-center gap-1.5"><LoaderCircle className="size-3 animate-spin" /> Updating</span>}</div>
          </aside>
        </div>

        <section className="mt-5 overflow-hidden rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.82)] shadow-[0_10px_30px_hsl(155_27%_15%/.035)]" data-testid="panel-points-history">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border)/.75)] px-5 py-4">
            <div>
              <p className="mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Your account, at a glance</p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-.04em]">Points activity</h2>
            </div>
            <span className="rounded-full bg-[hsl(var(--primary)/.08)] px-2.5 py-1 text-[10px] font-medium text-[hsl(var(--primary))]">Private to your wallet</span>
          </div>
          {historyQuery.isError && historyItems.length === 0 ? (
            <div className="p-5 text-center" role="alert" data-testid="error-points-history">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Points activity couldn’t be loaded.</p>
              <button type="button" onClick={() => void historyQuery.refetch()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid="button-retry-points-history"><RotateCw className="size-3" /> Try again</button>
            </div>
          ) : historyItems.length === 0 && historyQuery.isLoading ? (
            <div className="space-y-3 p-5" aria-label="Loading points activity" data-testid="loading-points-history"><div className="h-11 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /><div className="h-11 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /></div>
          ) : historyItems.length === 0 ? (
            <div className="px-5 py-8 text-center" data-testid="empty-points-history"><p className="text-sm font-medium">No points activity yet.</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Quest awards and coin-flip results will appear here.</p></div>
          ) : (
            <>
              <ol className="divide-y divide-[hsl(var(--border)/.65)]" data-testid="list-points-history">
                {historyItems.map((item) => {
                  const sign = item.pointsChange > 0 ? '+' : item.pointsChange < 0 ? '−' : '';
                  const detail = item.kind === 'coin_flip'
                    ? `Picked ${item.choice}; ${item.result} landed${item.won ? ` · ${item.payoutPoints} points paid out` : ` · ${item.stakePoints} point stake lost`}`
                    : 'Daily quest completed';
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid={`item-points-history-${item.id}`}>
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${item.pointsChange >= 0 ? 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]'}`}>
                        {item.kind === 'coin_flip' ? <Coins className="size-4" /> : <Check className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{item.description}</p>
                        <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{detail} · {new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                      </div>
                      <span className={`mono text-xs font-semibold tabular-nums ${item.pointsChange >= 0 ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--destructive))]'}`} data-testid={`text-history-points-${item.id}`}>{sign}{Math.abs(item.pointsChange).toLocaleString()} {Math.abs(item.pointsChange) === 1 ? 'point' : 'points'}</span>
                    </li>
                  );
                })}
              </ol>
              {historyQuery.isError && <p className="px-5 pt-3 text-xs text-[hsl(var(--destructive))]" role="alert">Older activity could not be loaded. Your current history is still shown.</p>}
              {historyQuery.data?.nextCursor && <div className="border-t border-[hsl(var(--border)/.75)] px-5 py-3 text-center"><button type="button" onClick={() => setHistoryCursor(historyQuery.data?.nextCursor ?? undefined)} disabled={historyQuery.isFetching} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)] disabled:opacity-50" data-testid="button-load-older-points-history">{historyQuery.isFetching ? <LoaderCircle className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" />}Load older activity</button></div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
