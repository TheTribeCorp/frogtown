import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Flag, Heart, MessageCircle, Send, RefreshCw, Waves, Radio, ChevronDown } from 'lucide-react';
import {
  getListTimelineCommentsQueryKey,
  getListTimelinePostsQueryKey,
  useCreateTimelineComment,
  useCreateTimelinePost,
  useLikeTimelinePost,
  useListTimelineComments,
  useListTimelinePosts,
  useReportTimelineContent,
  useUnlikeTimelinePost,
  type TimelineComment,
  type TimelinePost,
} from '@workspace/api-client-react';

const POST_LIMIT = 5000;
const COMMENT_LIMIT = 2000;

function shortAddress(address: string) {
  if (address.length < 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function AvatarMark({ address, mine = false }: { address: string; mine?: boolean }) {
  return (
    <div
      aria-label={mine ? 'Your wallet' : `Wallet ${shortAddress(address)}`}
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl border text-[11px] font-semibold tracking-tight ${mine ? 'border-[hsl(var(--secondary)/.75)] bg-[hsl(var(--secondary)/.3)] text-[hsl(var(--foreground))]' : 'border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.09)] text-[hsl(var(--primary))]'}`}
      data-testid={`avatar-wallet-${address}`}
    >
      {address.slice(0, 2).toUpperCase()}
    </div>
  );
}

type ReportSubjectType = 'post' | 'comment';
type ReportCategory = 'spam' | 'harassment' | 'hate' | 'violence' | 'misinformation' | 'other';

function ReportControl({
  subjectType,
  subjectId,
  reportedByMe,
  onReported,
}: {
  subjectType: ReportSubjectType;
  subjectId: string;
  reportedByMe: boolean;
  onReported: () => void;
}) {
  const reportMutation = useReportTimelineContent();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('spam');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    reportMutation.mutate({
      data: { subjectType, subjectId, category, details: details.trim() || undefined },
    }, {
      onSuccess: () => {
        setSubmitted(true);
        setOpen(false);
        onReported();
      },
      onError: (cause) => setError(cause instanceof Error ? cause.message : 'Report could not be sent. Try again.'),
    });
  };

  if (reportedByMe || submitted) {
    return <span className="inline-flex items-center gap-1.5 px-2 text-[10px] text-[hsl(var(--muted-foreground))]" aria-label="Already reported"><Flag className="size-3" /> Reported</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); setError(''); }}
        aria-expanded={open}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]"
        data-testid={`button-report-${subjectType}-${subjectId}`}
      >
        <Flag className="size-3.5" /> Report
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2 w-[min(18rem,calc(100vw-3rem))] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-xl" data-testid={`form-report-${subjectType}-${subjectId}`}>
          <label className="block text-[10px] font-medium" htmlFor={`report-category-${subjectId}`}>Why are you reporting this?</label>
          <select
            id={`report-category-${subjectId}`}
            value={category}
            onChange={(event) => setCategory(event.target.value as ReportCategory)}
            className="mt-2 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2.5 py-2 text-xs"
          >
            <option value="spam">Spam or scams</option>
            <option value="harassment">Harassment</option>
            <option value="hate">Hateful content</option>
            <option value="violence">Violence or threats</option>
            <option value="misinformation">Misleading content</option>
            <option value="other">Other</option>
          </select>
          <label className="sr-only" htmlFor={`report-details-${subjectId}`}>Optional report details</label>
          <textarea
            id={`report-details-${subjectId}`}
            value={details}
            maxLength={1000}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="Optional context"
            rows={2}
            className="mt-2 w-full resize-y rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2.5 py-2 text-xs"
          />
          {error && <p role="alert" className="mt-2 text-[10px] text-[hsl(var(--destructive))]">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2.5 py-1.5 text-[10px] hover:bg-[hsl(var(--muted))]">Cancel</button>
            <button type="submit" disabled={reportMutation.isPending} className="rounded-md bg-[hsl(var(--destructive))] px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-50">
              {reportMutation.isPending ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function TimelinePostCard({
  post,
  walletAddress,
  onPostUpdate,
}: {
  post: TimelinePost;
  walletAddress: string;
  onPostUpdate: (postId: string, update: Partial<TimelinePost>) => void;
}) {
  const client = useQueryClient();
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState('');
  const [commentCursor, setCommentCursor] = useState<string | undefined>();
  const [olderCommentPages, setOlderCommentPages] = useState<TimelineComment[][]>([]);
  const commentParams = { cursor: commentCursor, limit: 20 };
  const commentsQuery = useListTimelineComments(post.id, commentParams, {
    query: {
      enabled: commentOpen,
      queryKey: getListTimelineCommentsQueryKey(post.id, commentParams),
    },
  });
  const comments = [
    ...(commentsQuery.data?.items ?? []).slice().reverse(),
    ...olderCommentPages.slice().reverse().flatMap((page) => page.slice().reverse()),
  ];
  const createComment = useCreateTimelineComment();
  const likePost = useLikeTimelinePost();
  const unlikePost = useUnlikeTimelinePost();
  const isLikePending = likePost.isPending || unlikePost.isPending;

  const toggleLike = () => {
    const mutation = post.likedByMe ? unlikePost : likePost;
    mutation.mutate({ postId: post.id }, {
      onSuccess: (reaction) => {
        onPostUpdate(post.id, { likeCount: reaction.likeCount, likedByMe: reaction.likedByMe });
        void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
      },
    });
  };

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body) {
      setCommentError('Write a comment before sending.');
      return;
    }
    setCommentError('');
    createComment.mutate({ postId: post.id, data: { body } }, {
      onSuccess: () => {
        setCommentBody('');
        setCommentCursor(undefined);
        setOlderCommentPages([]);
        onPostUpdate(post.id, { commentCount: post.commentCount + 1 });
        void client.invalidateQueries({ queryKey: getListTimelineCommentsQueryKey(post.id) });
        void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
      },
      onError: (error) => setCommentError(error instanceof Error ? error.message : 'Your comment could not be sent. Try again.'),
    });
  };

  return (
    <article className="overflow-hidden rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.84)] shadow-[0_10px_28px_hsl(174_25%_13%/.035)] transition-colors hover:border-[hsl(var(--primary)/.28)]" data-testid={`card-timeline-post-${post.id}`}>
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <AvatarMark address={post.authorAddress} mine={post.authorAddress === walletAddress} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="mono text-xs font-medium text-[hsl(var(--foreground))]" data-testid={`text-post-author-${post.id}`}>{shortAddress(post.authorAddress)}</span>
              {post.authorAddress === walletAddress && <span className="rounded-full bg-[hsl(var(--secondary)/.24)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[.12em]">you</span>}
              <span aria-hidden="true" className="text-[hsl(var(--muted-foreground)/.55)]">·</span>
              <time className="mono text-[10px] text-[hsl(var(--muted-foreground))]" dateTime={post.createdAt} data-testid={`time-post-created-${post.id}`}>{timeLabel(post.createdAt)}</time>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-[1.75] text-[hsl(var(--foreground)/.88)] sm:text-[15px]" data-testid={`text-post-body-${post.id}`}>{post.body}</p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 border-t border-[hsl(var(--border)/.7)] pt-3">
          <button
            type="button"
            onClick={toggleLike}
            disabled={isLikePending}
            aria-label={post.likedByMe ? 'Unlike post' : 'Like post'}
            aria-pressed={post.likedByMe}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs transition hover:bg-[hsl(var(--accent)/.1)] disabled:cursor-wait disabled:opacity-55 ${post.likedByMe ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))]'}`}
            data-testid={`button-like-post-${post.id}`}
          >
            {isLikePending ? <RefreshCw className="size-4 animate-spin" /> : <Heart className={`size-4 ${post.likedByMe ? 'fill-current' : ''}`} />}
            <span data-testid={`text-like-count-${post.id}`}>{post.likeCount}</span>
            <span className="sr-only">{post.likedByMe ? 'likes; remove your like' : 'likes'}</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentOpen((open) => !open)}
            aria-expanded={commentOpen}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--primary)/.08)] hover:text-[hsl(var(--primary))]"
            data-testid={`button-toggle-comments-${post.id}`}
          >
            <MessageCircle className="size-4" />
            <span data-testid={`text-comment-count-${post.id}`}>{post.commentCount}</span>
            <span>{commentOpen ? 'Hide replies' : 'Comments'}</span>
          </button>
          <ReportControl
            subjectType="post"
            subjectId={post.id}
            reportedByMe={post.reportedByMe}
            onReported={() => {
              onPostUpdate(post.id, { reportedByMe: true });
              void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
            }}
          />
          <span className="mono ml-auto hidden text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground)/.6)] sm:block">public signal</span>
        </div>
      </div>
      {commentOpen && (
        <section className="border-t border-[hsl(var(--border)/.65)] bg-[hsl(var(--background)/.62)] px-5 py-4 sm:px-6" aria-label={`Comments on post by ${shortAddress(post.authorAddress)}`} data-testid={`section-comments-${post.id}`}>
          {commentsQuery.isLoading ? (
            <div className="space-y-3" aria-label="Loading comments" data-testid={`loading-comments-${post.id}`}>
              {[0, 1].map((item) => <div className="flex gap-3" key={item}><div className="size-8 animate-pulse rounded-lg bg-[hsl(var(--muted))]" /><div className="flex-1 pt-1"><div className="h-2.5 w-1/4 animate-pulse rounded bg-[hsl(var(--muted))]" /><div className="mt-2 h-2.5 w-3/4 animate-pulse rounded bg-[hsl(var(--muted))]" /></div></div>)}
            </div>
          ) : commentsQuery.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid={`error-comments-${post.id}`}>
              <span>Replies could not be loaded.</span>
              <button type="button" onClick={() => void commentsQuery.refetch()} className="font-medium underline underline-offset-2" data-testid={`button-retry-comments-${post.id}`}>Retry</button>
            </div>
          ) : (
            <div className="space-y-4" data-testid={`list-comments-${post.id}`}>
              {commentsQuery.data?.nextCursor && (
                <button
                  type="button"
                  disabled={commentsQuery.isFetching}
                  onClick={() => {
                    const page = commentsQuery.data;
                    if (!page?.nextCursor) return;
                    setOlderCommentPages((current) => [...current, page.items]);
                    setCommentCursor(page.nextCursor);
                  }}
                  className="w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.06)] disabled:opacity-50"
                  data-testid={`button-load-older-replies-${post.id}`}
                >
                  {commentsQuery.isFetching ? 'Loading replies…' : 'Load older replies'}
                </button>
              )}
              {comments.length === 0 ? (
                <p className="py-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid={`empty-comments-${post.id}`}>No replies yet. Start the conversation.</p>
              ) : comments.map((comment) => (
                <div className="flex gap-3" key={comment.id} data-testid={`item-comment-${comment.id}`}>
                  <AvatarMark address={comment.authorAddress} mine={comment.authorAddress === walletAddress} />
                  <div className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--border)/.8)] bg-[hsl(var(--card)/.75)] px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-[10px] font-medium" data-testid={`text-comment-author-${comment.id}`}>{shortAddress(comment.authorAddress)}</span>
                      <time className="mono text-[9px] text-[hsl(var(--muted-foreground))]" dateTime={comment.createdAt} data-testid={`time-comment-created-${comment.id}`}>{timeLabel(comment.createdAt)}</time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[hsl(var(--foreground)/.85)]" data-testid={`text-comment-body-${comment.id}`}>{comment.body}</p>
                    <div className="mt-2 flex justify-end">
                      <ReportControl
                        subjectType="comment"
                        subjectId={comment.id}
                        reportedByMe={comment.reportedByMe}
                        onReported={() => {
                          void client.invalidateQueries({ queryKey: getListTimelineCommentsQueryKey(post.id) });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={submitComment} className="mt-4 flex items-start gap-2.5" data-testid={`form-comment-${post.id}`}>
            <AvatarMark address={walletAddress} mine />
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`comment-input-${post.id}`}>Write a reply</label>
              <textarea
                id={`comment-input-${post.id}`}
                value={commentBody}
                maxLength={COMMENT_LIMIT}
                onChange={(event) => { setCommentBody(event.target.value); setCommentError(''); }}
                placeholder="Add to the thread…"
                rows={2}
                className="w-full resize-y rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-xs leading-5 outline-none transition placeholder:text-[hsl(var(--muted-foreground)/.65)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]"
                data-testid={`input-comment-${post.id}`}
              />
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                {commentError ? <p role="alert" className="text-[11px] text-[hsl(var(--destructive))]" data-testid={`error-comment-submit-${post.id}`}>{commentError}</p> : <span className="mono text-[9px] text-[hsl(var(--muted-foreground)/.75)]" data-testid={`text-comment-limit-${post.id}`}>{commentBody.length}/{COMMENT_LIMIT}</span>}
                <button type="submit" disabled={createComment.isPending || !commentBody.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[hsl(var(--foreground))] px-3 text-[11px] font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-45" data-testid={`button-submit-comment-${post.id}`}>
                  {createComment.isPending ? <RefreshCw className="size-3 animate-spin" /> : <Send className="size-3" />}
                  {createComment.isPending ? 'Sending' : 'Reply'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}
    </article>
  );
}

export function TimelinePage({ walletAddress }: { walletAddress: string }) {
  const client = useQueryClient();
  const [postCursor, setPostCursor] = useState<string | undefined>();
  const [postPages, setPostPages] = useState<Array<{ cursor?: string; items: TimelinePost[] }>>([]);
  const postParams = { cursor: postCursor, limit: 30 };
  const postsQuery = useListTimelinePosts(postParams, {
    query: {
      queryKey: getListTimelinePostsQueryKey(postParams),
      refetchInterval: 30000,
    },
  });
  useEffect(() => {
    const page = postsQuery.data;
    if (!page) return;
    setPostPages((current) => {
      const index = current.findIndex((item) => item.cursor === postCursor);
      if (index < 0) return [...current, { cursor: postCursor, items: page.items }];
      const next = [...current];
      next[index] = { cursor: postCursor, items: page.items };
      return next;
    });
  }, [postsQuery.data, postCursor]);
  const createPost = useCreateTimelinePost();
  const [body, setBody] = useState('');
  const [composerError, setComposerError] = useState('');
  const posts = postPages.length
    ? postPages.flatMap((page) => page.items)
    : postsQuery.data?.items ?? [];

  const updatePost = (postId: string, update: Partial<TimelinePost>) => {
    setPostPages((current) => {
      const pages = current.length
        ? current
        : postsQuery.data
          ? [{ cursor: postCursor, items: postsQuery.data.items }]
          : [];
      return pages.map((page) => ({
        ...page,
        items: page.items.map((post) => post.id === postId ? { ...post, ...update } : post),
      }));
    });
  };

  const submitPost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) {
      setComposerError('Add a little signal before posting.');
      return;
    }
    setComposerError('');
    createPost.mutate({ data: { body: text } }, {
      onSuccess: () => {
        setBody('');
        setPostCursor(undefined);
        setPostPages([]);
        void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
      },
      onError: (error) => setComposerError(error instanceof Error ? error.message : 'Your post could not be published. Try again.'),
    });
  };

  return (
    <div className="min-h-full px-4 pb-12 pt-6 sm:px-6 md:px-8 md:pt-8" data-testid="page-timeline">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-7 lg:grid-cols-[minmax(0,690px)_minmax(220px,1fr)] lg:gap-10">
        <main className="min-w-0">
          <div className="appear mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mono flex items-center gap-2 text-[10px] uppercase tracking-[.2em] text-[hsl(var(--primary))]" data-testid="text-timeline-eyebrow"><span className="size-1.5 rounded-full bg-[hsl(var(--primary))] pulse-dot" /> $HERMIT community / xrpl</p>
              <h1 className="mt-2 text-[2.15rem] font-semibold leading-none tracking-[-.07em] sm:text-4xl" data-testid="text-timeline-title">Frogtown feed.</h1>
            </div>
            <div className="mono hidden items-center gap-2 pb-1 text-[9px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))] sm:flex" data-testid="status-feed-public"><Radio className="size-3.5 text-[hsl(var(--accent))]" /> Public feed</div>
          </div>

          <form onSubmit={submitPost} className="appear appear-delay-1 mb-6 overflow-hidden rounded-[1.3rem] border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--card)/.88)] shadow-[0_14px_36px_hsl(174_25%_13%/.055)]" data-testid="form-create-post">
            <div className="flex items-start gap-3.5 p-4 sm:p-5">
              <AvatarMark address={walletAddress} mine />
              <div className="min-w-0 flex-1">
                <label htmlFor="timeline-post-body" className="sr-only">Write a public post</label>
                <textarea
                  id="timeline-post-body"
                  value={body}
                  maxLength={POST_LIMIT}
                  onChange={(event) => { setBody(event.target.value); setComposerError(''); }}
                  placeholder="What’s happening in Frogtown?"
                  rows={4}
                  className="min-h-[112px] w-full resize-y bg-transparent py-1 text-[15px] leading-6 outline-none placeholder:text-[hsl(var(--muted-foreground)/.68)] sm:text-base"
                  data-testid="input-create-post"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] bg-[hsl(var(--background)/.4)] px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-post-guidance"><Waves className="size-3.5 shrink-0 text-[hsl(var(--primary))]" /><span>Plain text, wallet-native. No attachments.</span></div>
              <div className="ml-auto flex items-center gap-3">
                <span className={`mono text-[9px] ${body.length > POST_LIMIT - 250 ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground)/.75)]'}`} aria-live="polite" data-testid="text-post-character-count">{body.length.toLocaleString()}/{POST_LIMIT.toLocaleString()}</span>
                <button type="submit" disabled={createPost.isPending || !body.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 text-xs font-medium text-[hsl(var(--card))] transition hover:-translate-y-0.5 hover:bg-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-publish-post">
                  {createPost.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  {createPost.isPending ? 'Publishing' : 'Post'}
                </button>
              </div>
            </div>
            {composerError && <p className="border-t border-[hsl(var(--destructive)/.15)] px-5 py-2.5 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid="error-create-post">{composerError}</p>}
          </form>

          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]" data-testid="text-feed-heading">Fresh from the marsh</h2>
            <button type="button" onClick={() => { setPostCursor(undefined); setPostPages([]); void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() }); }} disabled={postsQuery.isFetching} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--foreground))] disabled:opacity-55" aria-label="Refresh timeline" data-testid="button-refresh-timeline">
              <RefreshCw className={`size-3 ${postsQuery.isFetching ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {postsQuery.isLoading && postPages.length === 0 ? (
            <div className="space-y-3" aria-label="Loading timeline" data-testid="loading-timeline">
              {[0, 1, 2].map((item) => <div key={item} className="animate-pulse rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-5" data-testid={`skeleton-post-${item}`}><div className="flex gap-3"><div className="size-10 rounded-xl bg-[hsl(var(--muted))]" /><div className="flex-1 pt-1"><div className="h-3 w-1/3 rounded bg-[hsl(var(--muted))]" /><div className="mt-5 h-3 w-full rounded bg-[hsl(var(--muted))]" /><div className="mt-2 h-3 w-4/5 rounded bg-[hsl(var(--muted))]" /></div></div></div>)}
            </div>
          ) : postsQuery.isError && postPages.length === 0 ? (
            <section className="rounded-[1.25rem] border border-[hsl(var(--destructive)/.22)] bg-[hsl(var(--card)/.82)] p-6 text-center" role="alert" data-testid="error-timeline">
              <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]"><Radio className="size-5" /></div>
              <h3 className="mt-4 text-base font-semibold tracking-tight">The current went quiet.</h3>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-[hsl(var(--muted-foreground))]">We couldn’t reach the public feed. Your post composer is still here; try loading the timeline again.</p>
              <button type="button" onClick={() => void postsQuery.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--foreground))] px-3.5 py-2.5 text-xs font-medium text-[hsl(var(--card))] transition hover:bg-[hsl(var(--primary))]" data-testid="button-retry-timeline"><RefreshCw className="size-3.5" /> Try again</button>
            </section>
          ) : posts.length === 0 ? (
            <section className="relative overflow-hidden rounded-[1.25rem] border border-dashed border-[hsl(var(--primary)/.3)] bg-[hsl(var(--primary)/.035)] px-6 py-10 text-center sm:py-14" data-testid="empty-timeline">
              <div className="absolute -right-8 -top-8 size-32 rounded-full border border-[hsl(var(--primary)/.12)]" />
              <div className="absolute -right-1 top-0 size-16 rounded-full border border-[hsl(var(--secondary)/.28)]" />
              <div className="relative mx-auto flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Waves className="size-5" /></div>
              <p className="mono relative mt-5 text-[9px] uppercase tracking-[.2em] text-[hsl(var(--primary))]">unwritten water</p>
              <h3 className="relative mt-2 text-xl font-semibold tracking-[-.05em]">First word is yours.</h3>
              <p className="relative mx-auto mt-2 max-w-xs text-xs leading-5 text-[hsl(var(--muted-foreground))]">There’s nothing in the public current yet. Leave a thought above and set it moving.</p>
            </section>
          ) : (
            <div className="space-y-3.5" data-testid="list-timeline-posts">
              {posts.map((post) => <TimelinePostCard key={post.id} post={post} walletAddress={walletAddress} onPostUpdate={updatePost} />)}
              {postsQuery.data?.nextCursor && (
                <button
                  type="button"
                  disabled={postsQuery.isFetching}
                  onClick={() => setPostCursor(postsQuery.data?.nextCursor ?? undefined)}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] px-4 py-3 text-xs font-medium text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.06)] disabled:opacity-50"
                  data-testid="button-load-older-posts"
                >
                  {postsQuery.isFetching ? 'Loading posts…' : 'Load older posts'}
                </button>
              )}
            </div>
          )}
        </main>

        <aside className="hidden lg:block" aria-label="Timeline notes">
          <div className="sticky top-7 space-y-4">
            <section className="relative overflow-hidden rounded-[1.25rem] bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))]" data-testid="panel-public-current">
              <div className="absolute -right-10 -top-8 size-32 rounded-full border border-[hsl(var(--secondary)/.2)]" />
              <div className="absolute right-2 top-3 size-16 rounded-full border border-[hsl(var(--primary)/.3)]" />
              <p className="mono relative text-[9px] uppercase tracking-[.18em] text-[hsl(var(--secondary))]">one ledger / many voices</p>
              <h2 className="relative mt-5 text-2xl font-semibold leading-[1.03] tracking-[-.06em]">Talk in<br />the open.</h2>
              <p className="relative mt-3 text-xs leading-5 text-[hsl(var(--sidebar-foreground)/.65)]">A shared feed for the $HERMIT community. Private chats stay encrypted; here, members can post, like, and reply together.</p>
              <div className="relative mt-5 flex items-center gap-2 border-t border-[hsl(var(--sidebar-foreground)/.12)] pt-4">
                <span className="flex size-7 items-center justify-center rounded-lg bg-[hsl(var(--secondary)/.16)] text-[hsl(var(--secondary))]"><Radio className="size-3.5" /></span>
                 <span className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--sidebar-foreground)/.7)]">wallet-native feed</span>
                <ChevronDown className="ml-auto size-3.5 -rotate-90 text-[hsl(var(--sidebar-foreground)/.36)]" />
              </div>
            </section>
            <p className="px-2 text-[10px] leading-5 text-[hsl(var(--muted-foreground)/.7)]" data-testid="text-wallet-identity-note">Your wallet address is your name here. No handles, profile theatre, or uploads.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default TimelinePage;
