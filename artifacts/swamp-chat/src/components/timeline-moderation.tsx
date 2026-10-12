import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Flag, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import {
  getListTimelineCommentsQueryKey,
  getListTimelineModerationReportsQueryKey,
  getListTimelinePostsQueryKey,
  useListTimelineModerationReports,
  useResolveTimelineModerationReport,
} from '@workspace/api-client-react';

function compactAddress(address: string) {
  return address.length < 18 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function reportedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function TimelineModerationPanel({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const [actionError, setActionError] = useState('');
  const queue = useListTimelineModerationReports({
    query: { enabled, queryKey: getListTimelineModerationReportsQueryKey() },
  });
  const resolveReport = useResolveTimelineModerationReport();

  const resolve = (subjectType: 'post' | 'comment', subjectId: string, action: 'dismiss' | 'remove') => {
    if (action === 'remove' && !window.confirm('Remove this reported content from the public timeline? This cannot be undone.')) return;
    setActionError('');
    resolveReport.mutate({ subjectType, subjectId, data: { action } }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListTimelineModerationReportsQueryKey() });
        if (action === 'remove') {
          void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
          void client.invalidateQueries({
            predicate: (query) => typeof query.queryKey[0] === 'string'
              && query.queryKey[0].startsWith('/api/timeline/posts/')
              && query.queryKey[0].endsWith('/comments'),
          });
        }
      },
      onError: (cause) => setActionError(cause instanceof Error ? cause.message : 'The report could not be resolved. Please try again.'),
    });
  };

  if (!enabled) return null;
  return (
    <section className="mb-6 overflow-hidden rounded-[1.25rem] border border-[hsl(var(--secondary)/.3)] bg-[hsl(var(--card)/.88)] shadow-[0_10px_28px_hsl(174_25%_13%/.04)]" aria-label="Moderator report queue" data-testid="panel-moderation-queue">
      <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border)/.75)] bg-[hsl(var(--secondary)/.08)] px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary)/.18)] text-[hsl(var(--secondary))]"><ShieldCheck className="size-4" /></span>
          <div><p className="mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--secondary))]">moderator tools</p><h2 className="mt-1 text-base font-semibold tracking-[-.03em]">Community reports</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Review reported public posts and replies.</p></div>
        </div>
        {!queue.isLoading && !queue.isError && <span className="mono rounded-full bg-[hsl(var(--card))] px-2.5 py-1 text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-report-count">{queue.data?.items.length ?? 0} open</span>}
      </div>
      <div className="p-4 sm:p-5">
        {actionError && <p className="mb-3 rounded-lg border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid="error-moderation-action">{actionError}</p>}
        {queue.isLoading ? (
          <div className="space-y-3" aria-label="Loading reports" data-testid="loading-moderation-queue">
            {[0, 1].map((index) => <div key={index} className="animate-pulse rounded-xl border border-[hsl(var(--border))] p-4"><div className="h-3 w-1/4 rounded bg-[hsl(var(--muted))]" /><div className="mt-3 h-3 w-full rounded bg-[hsl(var(--muted))]" /><div className="mt-2 h-3 w-2/3 rounded bg-[hsl(var(--muted))]" /></div>)}
          </div>
        ) : queue.isError ? (
          <div className="flex items-start gap-2 rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid="error-moderation-queue">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Reports could not be loaded. Refresh the timeline to try again.</span>
            <button type="button" onClick={() => void queue.refetch()} className="ml-auto font-medium underline underline-offset-2" data-testid="button-retry-moderation">Retry</button>
          </div>
        ) : queue.data?.items.length ? (
          <div className="space-y-3" data-testid="list-moderation-reports">
            {queue.data.items.map((item) => (
              <article key={`${item.subjectType}-${item.subjectId}`} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.55)] p-4" data-testid={`item-moderation-${item.subjectType}-${item.subjectId}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--destructive)/.08)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--destructive))]"><Flag className="size-3" /> {item.subjectType}</span>
                  <span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{compactAddress(item.authorAddress)}</span>
                  <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">{item.reports.length} {item.reports.length === 1 ? 'report' : 'reports'}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-[hsl(var(--border)/.7)] bg-[hsl(var(--card)/.78)] px-3 py-2.5 text-sm leading-6">{item.body}</p>
                <div className="mt-3 space-y-2">
                  {item.reports.map((report, index) => (
                    <div key={`${report.walletAddress}-${report.createdAt}-${index}`} className="flex items-start gap-2 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[hsl(var(--secondary))]" />
                      <p><strong className="font-semibold text-[hsl(var(--foreground))]">{report.category}</strong> · {compactAddress(report.walletAddress)} · {reportedAt(report.createdAt)}{report.details ? <span className="block mt-0.5 text-[hsl(var(--foreground)/.72)]">{report.details}</span> : null}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--border)/.7)] pt-3">
                  <button type="button" disabled={resolveReport.isPending} onClick={() => resolve(item.subjectType, item.subjectId, 'dismiss')} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-[10px] font-medium text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)/.35)] hover:text-[hsl(var(--primary))] disabled:opacity-50" data-testid={`button-dismiss-report-${item.subjectType}-${item.subjectId}`}><Check className="size-3.5" /> Dismiss report</button>
                  <button type="button" disabled={resolveReport.isPending} onClick={() => resolve(item.subjectType, item.subjectId, 'remove')} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--destructive))] px-3 text-[10px] font-medium text-[hsl(var(--destructive-foreground))] transition hover:opacity-90 disabled:opacity-50" data-testid={`button-remove-reported-${item.subjectType}-${item.subjectId}`}>{resolveReport.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Remove content</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.035)] px-4 py-6 text-center" data-testid="empty-moderation-queue">
            <span className="mx-auto flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Check className="size-4" /></span>
            <p className="mt-3 text-sm font-medium">All clear for now</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">New community reports will appear here.</p>
          </div>
        )}
      </div>
    </section>
  );
}
