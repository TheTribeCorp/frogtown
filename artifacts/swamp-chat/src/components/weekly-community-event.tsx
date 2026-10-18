import { useGetGamificationWeeklyEvent, getGetGamificationWeeklyEventQueryKey } from '@workspace/api-client-react';
import { ArrowRight, Check, CircleAlert, Copy, LoaderCircle, MessageCircle, Send, Users } from 'lucide-react';
import { Link } from 'wouter';

type WeeklyCommunityEventProps = {
  walletAddress?: string;
  onCopyInvite: () => void;
  inviteCopied: boolean;
  inviteCopyError: boolean;
};

function formatWeekRange(weekStart: string, weekEnd: string) {
  const format = (value: string) => new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
  return `${format(weekStart)}–${format(weekEnd)} · UTC`;
}

export function WeeklyCommunityEvent({
  walletAddress,
  onCopyInvite,
  inviteCopied,
  inviteCopyError,
}: WeeklyCommunityEventProps) {
  const eventQuery = useGetGamificationWeeklyEvent({
    query: {
      enabled: Boolean(walletAddress),
      queryKey: [...getGetGamificationWeeklyEventQueryKey(), walletAddress ?? 'signed-out'],
      refetchInterval: 30_000,
      staleTime: 15_000,
      retry: 1,
    },
  });

  if (!walletAddress) return null;

  if (eventQuery.isLoading) {
    return (
      <section className="space-y-3 rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.78)] p-5" aria-label="Loading this week's community event" data-testid="loading-weekly-event">
        <div className="h-5 w-48 animate-pulse rounded bg-[hsl(var(--muted))]" />
        <div className="h-20 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
        <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
      </section>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <section className="rounded-[1.5rem] border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--card))] p-5" role="alert" data-testid="error-weekly-event">
        <p className="flex items-center gap-2 text-sm font-medium"><CircleAlert className="size-4 text-[hsl(var(--destructive))]" />This week’s event couldn’t load.</p>
        <button type="button" onClick={() => void eventQuery.refetch()} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid="button-retry-weekly-event">Try again</button>
      </section>
    );
  }

  const event = eventQuery.data;
  const actionIcon = (action: string) => {
    if (action === 'timeline') return <Send className="size-3.5" />;
    if (action === 'groups') return <MessageCircle className="size-3.5" />;
    return inviteCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />;
  };
  const actionLabel = (action: string) => {
    if (action === 'timeline') return 'Post to timeline';
    if (action === 'groups') return 'Find a room';
    return inviteCopied ? 'Invite link copied' : 'Copy invite link';
  };

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-[hsl(var(--primary)/.2)] bg-[linear-gradient(125deg,hsl(var(--primary)/.08),hsl(var(--card)/.96)_60%)] p-4 shadow-[0_12px_32px_hsl(155_27%_15%/.04)] sm:p-5" data-testid="panel-weekly-event">
      <div className="pointer-events-none absolute -right-10 -top-14 size-44 rounded-full border border-[hsl(var(--primary)/.12)]" aria-hidden="true" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono flex items-center gap-2 text-[9px] uppercase tracking-[.18em] text-[hsl(var(--primary))]"><span className="size-1.5 rounded-full bg-[hsl(var(--primary))]" /> Weekly event · async community session</p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-[-.045em]">{event.title}</h2>
        </div>
        <span className="rounded-full border border-[hsl(var(--primary)/.16)] bg-[hsl(var(--card)/.82)] px-3 py-1.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]" data-testid="text-weekly-event-dates">{formatWeekRange(event.weekStart, event.weekEnd)}</span>
      </div>

      <div className="relative mt-4 flex gap-3 rounded-xl border border-[hsl(var(--border)/.8)] bg-[hsl(var(--card)/.76)] p-3.5 sm:p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Users className="size-4" aria-hidden="true" /></div>
        <div className="min-w-0">
          <p className="mono text-[9px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">This week’s conversation</p>
          <p className="mt-1 text-sm font-medium leading-5">{event.prompt}</p>
          <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Join in whenever you like; the prompt changes each Monday at 00:00 UTC.</p>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {event.missions.map((mission) => {
          const percent = Math.min(100, Math.max(0, (mission.progress / mission.target) * 100));
          const completed = mission.progress >= mission.target;
          const yourProgress = mission.id === 'qualified_invite'
            ? `${mission.myProgress} active invite${mission.myProgress === 1 ? '' : 's'}`
            : mission.myProgress > 0 ? 'You contributed this week' : 'Your contribution: not yet';

          return (
            <article key={mission.id} className="rounded-xl border border-[hsl(var(--border)/.82)] bg-[hsl(var(--card)/.82)] p-3.5" data-testid={`weekly-mission-${mission.id}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xs font-semibold leading-5">{mission.title}</h3>
                {completed && <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/.11)] text-[hsl(var(--primary))]" aria-label="Community goal reached"><Check className="size-3" /></span>}
              </div>
              <p className="mt-1 min-h-10 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">{mission.description}</p>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"
                role="progressbar"
                aria-label={`${mission.title} community progress`}
                aria-valuemin={0}
                aria-valuemax={mission.target}
                aria-valuenow={Math.min(mission.progress, mission.target)}
                aria-valuetext={`${mission.progress} of ${mission.target} toward the community goal`}
              >
                <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--sidebar-accent)))] transition-[width] duration-500" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="mono text-[9px] font-medium tabular-nums">{mission.progress.toLocaleString()} / {mission.target}</span>
                <span className="text-right text-[9px] text-[hsl(var(--muted-foreground))]">{yourProgress}</span>
              </div>
              {mission.action === 'timeline' ? (
                <Link href="/timeline" className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid={`link-weekly-mission-${mission.id}`}>{actionLabel(mission.action)}<ArrowRight className="size-3" /></Link>
              ) : mission.action === 'groups' ? (
                <Link href="/groups" className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid={`link-weekly-mission-${mission.id}`}>{actionLabel(mission.action)}<ArrowRight className="size-3" /></Link>
              ) : (
                <button type="button" onClick={onCopyInvite} className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.07)]" data-testid={`button-weekly-mission-${mission.id}`}>{actionIcon(mission.action)}{actionLabel(mission.action)}</button>
              )}
            </article>
          );
        })}
      </div>
      {inviteCopyError && <p className="relative mt-3 text-[10px] text-[hsl(var(--destructive))]" role="status">Copy was blocked by this browser. You can copy your invite link from the referral panel below.</p>}
      <p className="relative mt-3 text-[9px] leading-4 text-[hsl(var(--muted-foreground))]">Progress counts distinct members for timeline and room missions. Invites count only after a new member completes all four daily quests in one day. These shared goals don’t add extra points or count repeated activity.</p>
    </section>
  );
}
