import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
  Platform,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGamificationHistoryQueryKey,
  getGetGamificationLeaderboardQueryKey,
  getGetGamificationReferralsQueryKey,
  getGetGamificationSummaryQueryKey,
  getGetGamificationWeeklyEventQueryKey,
  useCheckInGamification,
  useGetGamificationHistory,
  useGetGamificationLeaderboard,
  useGetGamificationReferrals,
  useGetGamificationSummary,
  useGetGamificationWeeklyEvent,
  usePlayGamificationCoinFlip,
  type GamificationTaskId,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Button, Field, Label, Panel } from '@/components/ui';
import { errorText } from '@/lib/api';

type Destination = 'chats' | 'groups' | 'timeline' | 'quests';
type Props = { walletAddress: string; onNavigate: (destination: Destination) => void };
type FlipChoice = 'heads' | 'tails';

const questDetails: Record<GamificationTaskId, { title: string; detail: string; icon: keyof typeof Ionicons.glyphMap; destination?: Destination }> = {
  check_in: { title: 'Daily check-in', detail: 'Visit Frogtown and keep your streak alive.', icon: 'calendar-outline' },
  ledger_minute: { title: 'Post to the timeline', detail: 'Share a thought with the community.', icon: 'create-outline', destination: 'timeline' },
  community_engagement: { title: 'Show up for someone', detail: 'Like and comment on another member’s post.', icon: 'heart-outline', destination: 'timeline' },
  room_spotlight: { title: 'Say hello in a room', detail: 'Send a message in a community group.', icon: 'people-outline', destination: 'groups' },
};

function CardTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  const c = useColors();
  return <View style={{ gap: 4 }}><Text style={{ color: c.primary, fontSize: 10, letterSpacing: 1.4, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' }}>{eyebrow}</Text><Text style={{ color: c.foreground, fontSize: 19, fontFamily: 'Inter_700Bold' }}>{title}</Text></View>;
}

function Meter({ value, total }: { value: number; total: number }) {
  const c = useColors();
  const percent = total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0;
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: Math.min(value, total) }} style={{ height: 8, borderRadius: 6, overflow: 'hidden', backgroundColor: c.muted }}>
    <View style={{ height: '100%', width: `${percent}%`, backgroundColor: c.primary, borderRadius: 6 }} />
  </View>;
}

function shortWallet(address: string) {
  return address.length > 18 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;
}

function untilUtcReset() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const seconds = Math.max(0, Math.floor((tomorrow.getTime() - now.getTime()) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function MobileQuestsScreen({ walletAddress, onNavigate }: Props) {
  const c = useColors();
  const client = useQueryClient();
  const summary = useGetGamificationSummary({ query: { refetchInterval: 30_000 } });
  const leaderboard = useGetGamificationLeaderboard({ query: { refetchInterval: 30_000 } });
  const referrals = useGetGamificationReferrals({ query: { enabled: Boolean(walletAddress), refetchInterval: 30_000 } });
  const weekly = useGetGamificationWeeklyEvent({ query: { enabled: Boolean(walletAddress), refetchInterval: 30_000 } });
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const historyParams = { cursor: historyCursor, limit: 20 };
  const history = useGetGamificationHistory(historyParams, {
    query: { enabled: Boolean(walletAddress), queryKey: [...getGetGamificationHistoryQueryKey(historyParams), walletAddress], refetchInterval: 30_000 },
  });
  const [historyItems, setHistoryItems] = useState<NonNullable<typeof history.data>['items']>([]);
  const checkIn = useCheckInGamification();
  const flip = usePlayGamificationCoinFlip();
  const [flipChoice, setFlipChoice] = useState<FlipChoice>('heads');
  const pendingFlip = useRef<{ requestId: string; choice: FlipChoice } | null>(null);
  const [lastFlip, setLastFlip] = useState<Awaited<ReturnType<typeof flip.mutateAsync>> | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(untilUtcReset());
  const extra = Constants.expoConfig?.extra as { productionApiOrigin?: string } | undefined;
  const appOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : extra?.productionApiOrigin ?? '';
  const inviteUrl = appOrigin ? `${appOrigin.replace(/\/$/, '')}/?ref=${encodeURIComponent(walletAddress)}` : '';
  const data = summary.data;
  const points = data?.points ?? 0;
  const tasks = data?.tasks ?? [];
  const completed = tasks.filter((task) => task.completed).length;

  useEffect(() => {
    setHistoryCursor(undefined);
    setHistoryItems([]);
  }, [walletAddress]);
  useEffect(() => {
    if (!history.data) return;
    setHistoryItems((current) => {
      const ids = new Set(current.map((item) => item.id));
      const incoming = history.data.items.filter((item) => !ids.has(item.id));
      return historyCursor ? [...current, ...incoming] : [...incoming];
    });
  }, [history.data, historyCursor]);
  useEffect(() => {
    const timer = setInterval(() => setClock(untilUtcReset()), 1000);
    return () => clearInterval(timer);
  }, []);

  const invalidateGamification = () => {
    void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
    void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
    void client.invalidateQueries({ queryKey: getGetGamificationReferralsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetGamificationHistoryQueryKey() });
    void client.invalidateQueries({ queryKey: getGetGamificationWeeklyEventQueryKey() });
  };

  const shareInvite = async () => {
    setNotice('');
    if (!inviteUrl) {
      setError('The invite link is unavailable. Try again after reconnecting.');
      return;
    }
    try {
      if (Platform.OS === 'web') {
        if (!navigator.clipboard) throw new Error('Clipboard access is unavailable in this browser.');
        await navigator.clipboard.writeText(inviteUrl);
        setNotice('Invite link copied.');
      } else {
        await Share.share({ message: `Join me in Frogtown, the $HERMIT community: ${inviteUrl}`, url: inviteUrl });
        setNotice('Invite link ready to share.');
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const playFlip = () => {
    setError('');
    const attempt = pendingFlip.current ?? { requestId: Crypto.randomUUID(), choice: flipChoice };
    pendingFlip.current = attempt;
    flip.mutate({ data: attempt }, {
      onSuccess: (result) => {
        pendingFlip.current = null;
        setLastFlip(result);
        invalidateGamification();
      },
      onError: (cause) => setError(`${errorText(cause)} Retrying reuses the same flip request.`),
    });
  };

  const refresh = async () => {
    setError('');
    await Promise.all([summary.refetch(), leaderboard.refetch(), referrals.refetch(), weekly.refetch(), history.refetch()]);
  };

  if (summary.isLoading && !data) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 }}><ActivityIndicator color={c.primary} /><Label muted>Loading your daily quests…</Label></View>;
  }
  if (summary.isError || !data) {
    return <View style={{ padding: 20, gap: 12 }}><Panel><CardTitle eyebrow="Daily quests" title="The pond is quiet right now" /><Label muted>{errorText(summary.error)}</Label><Button title="Try again" onPress={() => void summary.refetch()} /></Panel></View>;
  }

  return <ScrollView
    style={{ flex: 1 }}
    contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 22, gap: 14 }}
    refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={() => void refresh()} tintColor={c.primary} />}
    keyboardShouldPersistTaps="handled"
  >
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}><CardTitle eyebrow="The neighborhood · daily rituals" title="A little good every day." /></View>
      <View style={{ alignItems: 'flex-end' }}><Label muted>Reset in</Label><Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontVariant: ['tabular-nums'] }}>{clock} UTC</Text></View>
    </View>

    <Panel style={{ backgroundColor: c.forest, borderColor: c.forest }}>
      <Text style={{ color: c.leaf, fontSize: 10, letterSpacing: 1.2, fontFamily: 'Inter_600SemiBold' }}>YOUR FROGTOWN POCKET</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
        <View><Text accessibilityLabel={`${points} game points`} style={{ color: c.paper, fontSize: 42, fontFamily: 'Inter_700Bold', letterSpacing: -2 }}>{points.toLocaleString()}</Text><Text style={{ color: c.paper, opacity: 0.76 }}>game points · never transferable or cashable</Text></View>
        <View style={{ alignItems: 'flex-end' }}><Text style={{ color: c.leaf, fontSize: 11 }}>CURRENT STREAK</Text><Text style={{ color: c.paper, fontSize: 22, fontFamily: 'Inter_700Bold' }}>{data.currentStreak} days</Text></View>
      </View>
      <Meter value={completed} total={4} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: c.paper }}>Today’s quests: {completed}/4</Text><Text style={{ color: c.paper, opacity: 0.8 }}>Best: {data.longestStreak} days</Text></View>
    </Panel>

    <Panel>
      <CardTitle eyebrow="Community milestone" title={`${data.communityGoalPoints.toLocaleString()} points, together`} />
      <Meter value={data.communityPointsEarned} total={data.communityGoalPoints} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Label>{data.communityPointsEarned.toLocaleString()} earned</Label><Label muted>{Math.min(100, data.communityPointsEarned / data.communityGoalPoints * 100).toFixed(1)}%</Label></View>
      <Label muted>Lifetime points awarded across Frogtown. Coin-flip losses do not reduce this total.</Label>
    </Panel>

    <Panel>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><CardTitle eyebrow="Small things, good neighbors" title="Today’s quests" /><Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>1 pt each</Text></View>
      {tasks.map((task) => {
        const detail = questDetails[task.id];
        const isCheckIn = task.id === 'check_in';
        return <View key={task.id} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={task.completed ? 'checkmark-circle' : detail.icon} size={23} color={task.completed ? c.primary : c.mutedForeground} />
            <View style={{ flex: 1 }}><Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{detail.title}</Text><Text style={{ color: c.mutedForeground, fontSize: 12, lineHeight: 18 }}>{detail.detail}</Text>{task.target > 1 && !task.completed ? <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{task.progress}/{task.target} steps</Text> : null}</View>
            {task.completed && <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>Done</Text>}
          </View>
          {!task.completed && (isCheckIn
            ? <Button title={checkIn.isPending ? 'Saving…' : 'Check in'} busy={checkIn.isPending} onPress={() => { setError(''); checkIn.mutate(undefined, { onSuccess: invalidateGamification, onError: (cause) => setError(errorText(cause)) }); }} />
            : <Button secondary title={detail.destination === 'groups' ? 'Open groups' : 'Open timeline'} onPress={() => detail.destination && onNavigate(detail.destination)} />)}
        </View>;
      })}
      {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
    </Panel>

    {weekly.data && <Panel>
      <CardTitle eyebrow="Weekly community event" title={weekly.data.title} />
      <Text style={{ color: c.foreground, lineHeight: 21 }}>{weekly.data.prompt}</Text>
      <Label muted>{weekly.data.weekStart} – {weekly.data.weekEnd} · UTC</Label>
      {weekly.data.missions.map((mission) => <View key={mission.id} style={{ gap: 7, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: c.foreground, flex: 1, fontFamily: 'Inter_600SemiBold' }}>{mission.title}</Text><Text style={{ color: c.primary }}>{mission.progress}/{mission.target}</Text></View>
        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{mission.description} · {mission.myProgress > 0 ? 'You contributed' : 'Your contribution: not yet'}</Text>
        <Meter value={mission.progress} total={mission.target} />
        <Button secondary title={mission.action === 'timeline' ? 'Post to timeline' : mission.action === 'groups' ? 'Find a group' : 'Share invite link'} onPress={() => mission.action === 'timeline' ? onNavigate('timeline') : mission.action === 'groups' ? onNavigate('groups') : void shareInvite()} />
      </View>)}
    </Panel>}

    <Panel>
      <CardTitle eyebrow="Permanent keepsake" title="Frog badge" />
      {data.frogBadgeEarned
        ? <Label>Badge earned{data.frogBadgeEarnedAt ? ` on ${new Date(data.frogBadgeEarnedAt).toLocaleDateString()}` : ''} — yours to keep.</Label>
        : <><Label muted>{Math.max(0, 100 - points)} more points to unlock the permanent badge.</Label><Meter value={Math.min(100, points)} total={100} /></>}
    </Panel>

    <Panel>
      <CardTitle eyebrow="Just for fun · game points only" title="Coin flip" />
      <Label muted>Stake 1 point. Win: 1.80 points back (0.80 net). Lose: the point stake.</Label>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {(['heads', 'tails'] as const).map((side) => <View key={side} style={{ flex: 1 }}><Button secondary={flipChoice !== side} title={side[0].toUpperCase() + side.slice(1)} disabled={flip.isPending || Boolean(pendingFlip.current)} onPress={() => setFlipChoice(side)} /></View>)}
      </View>
      <Button title={flip.isPending ? 'Resolving…' : pendingFlip.current ? 'Retry same flip' : points < 1 ? 'Earn a point to play' : 'Flip for 1 point'} busy={flip.isPending} disabled={points < 1 && !pendingFlip.current} onPress={playFlip} />
      {lastFlip && <Label>{lastFlip.won ? 'You won' : 'Not this time'} — {lastFlip.result} landed. {lastFlip.netChangePoints > 0 ? '+' : ''}{lastFlip.netChangePoints} points; balance {lastFlip.points}.</Label>}
      {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
    </Panel>

    <Panel>
      <CardTitle eyebrow="Around the pond" title="Top 10 points" />
      {leaderboard.data?.items.slice(0, 10).map((entry) => <View key={entry.walletAddress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: c.border }}>
        <Text style={{ width: 28, color: entry.rank === 1 ? c.secondary : c.mutedForeground, fontFamily: 'Inter_700Bold' }}>{String(entry.rank).padStart(2, '0')}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{entry.username ? `@${entry.username}` : shortWallet(entry.walletAddress)}{entry.walletAddress === walletAddress ? ' · you' : ''}</Text><Text style={{ color: c.mutedForeground, fontSize: 11 }}>{entry.currentStreak} day streak{entry.frogBadgeEarned ? ' · Frog badge' : ''}</Text></View>
        <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold' }}>{entry.points.toLocaleString()}</Text>
      </View>)}
      {leaderboard.isError && <Label muted>Points standings are temporarily unavailable.</Label>}
    </Panel>

    <Panel>
      <CardTitle eyebrow="Invite good neighbors" title="Your referral link" />
      <Label muted>Earn {referrals.data?.rewardPoints ?? 2} points for each eligible new member after they finish the required setup. Genuine members only; no device fingerprinting.</Label>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Label>Earned: {referrals.data?.referralCount ?? 0}</Label><Label>Pending: {referrals.data?.pendingReferralCount ?? 0}</Label></View>
      {referrals.data?.myReferralQualification && <View style={{ gap: 7 }}>
        <Label>{referrals.data.myReferralQualification.status === 'rewarded' ? 'Your referrer’s reward is unlocked.' : `Your activity for your referrer: ${referrals.data.myReferralQualification.completedQuestCount}/${referrals.data.myReferralQualification.requiredQuestCount} daily quests.`}</Label>
        <Meter value={referrals.data.myReferralQualification.completedQuestCount} total={referrals.data.myReferralQualification.requiredQuestCount} />
        {([
          ['check_in', 'Daily check-in'],
          ['ledger_minute', 'Post to the timeline'],
          ['community_engagement', 'Like and comment'],
          ['room_spotlight', 'Post in a group'],
        ] as const).map(([id, label]) => <Text key={id} style={{ color: referrals.data?.myReferralQualification?.completedQuestIds.includes(id) ? c.primary : c.mutedForeground, fontSize: 12 }}>
          {referrals.data?.myReferralQualification?.completedQuestIds.includes(id) ? '✓' : '○'} {label}
        </Text>)}
      </View>}
      <Field accessibilityLabel="Your referral link" value={inviteUrl} editable={false} selectTextOnFocus />
      <Button title="Share invite link" onPress={() => void shareInvite()} />
      {!!notice && <Label>{notice}</Label>}
      {!!referrals.error && <Label muted>Referral information is temporarily unavailable.</Label>}
      {referrals.data?.leaderboard.slice(0, 10).map((entry) => <View key={entry.walletAddress} style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}><Text style={{ color: c.foreground }}>{entry.rank}. {entry.username ? `@${entry.username}` : shortWallet(entry.walletAddress)}</Text><Text style={{ color: c.primary }}>{entry.referralCount} invites</Text></View>)}
    </Panel>

    <Panel>
      <CardTitle eyebrow="Private to your wallet" title="Points activity" />
      {historyItems.map((item) => <View key={item.id} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 9, gap: 3 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: c.foreground, flex: 1, fontFamily: 'Inter_600SemiBold' }}>{item.description}</Text><Text style={{ color: item.pointsChange >= 0 ? c.primary : c.destructive, fontFamily: 'Inter_700Bold' }}>{item.pointsChange > 0 ? '+' : ''}{item.pointsChange}</Text></View>
        <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{item.kind === 'coin_flip' ? `Picked ${item.choice}; ${item.result} landed` : item.kind === 'referral' ? 'Referral reward' : 'Daily quest'} · {new Date(item.createdAt).toLocaleString()}</Text>
      </View>)}
      {!historyItems.length && <Label muted>No points activity yet.</Label>}
      {history.data?.nextCursor && <Button secondary title={history.isFetching ? 'Loading…' : 'Load older activity'} disabled={history.isFetching} onPress={() => setHistoryCursor(history.data?.nextCursor ?? undefined)} />}
      {history.isError && <Label muted>Some points activity could not be loaded.</Label>}
    </Panel>
  </ScrollView>;
}
