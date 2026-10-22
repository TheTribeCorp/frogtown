import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGamificationLeaderboardQueryKey,
  getGetGamificationSummaryQueryKey,
  getListTimelineCommentsQueryKey,
  getListTimelinePostsQueryKey,
  useCreateTimelineComment,
  useCreateTimelinePost,
  useDeleteTimelineComment,
  useDeleteTimelinePost,
  useLikeTimelinePost,
  useListTimelineComments,
  useListTimelinePosts,
  useReportTimelineContent,
  useUnlikeTimelinePost,
  useUpdateTimelineComment,
  useUpdateTimelinePost,
  type TimelineComment,
  type TimelinePost,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Button, Field, Label, Panel } from '@/components/ui';
import { errorText } from '@/lib/api';

const POST_LIMIT = 5000;
const COMMENT_LIMIT = 2000;
const reportCategories = [
  { label: 'Spam or scam', value: 'spam' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Hateful content', value: 'hate' },
  { label: 'Violence or threats', value: 'violence' },
  { label: 'Misleading information', value: 'misinformation' },
  { label: 'Other', value: 'other' },
] as const;

function shortAddress(address: string) {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function ageLabel(value: string) {
  const date = new Date(value);
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (!Number.isFinite(mins)) return 'recently';
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10_080) return `${Math.floor(mins / 1440)}d`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ReportMenu({
  subjectType,
  subjectId,
  postId,
  reportedByMe,
  onReported,
}: {
  subjectType: 'post' | 'comment';
  subjectId: string;
  postId?: string;
  reportedByMe: boolean;
  onReported: () => void;
}) {
  const c = useColors();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const report = useReportTimelineContent();
  const submit = (category: (typeof reportCategories)[number]['value']) => {
    report.mutate({ data: { subjectType, subjectId, category } }, {
      onSuccess: (result) => {
        setOpen(false);
        setMessage(result.alreadyReported ? 'Already reported' : 'Report sent');
        void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
        if (subjectType === 'comment' && postId) void client.invalidateQueries({ queryKey: getListTimelineCommentsQueryKey(postId) });
        onReported();
      },
      onError: (cause) => setMessage(errorText(cause)),
    });
  };
  return <View style={{ alignItems: 'flex-end', gap: 5 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={reportedByMe || message === 'Report sent' ? 'Content already reported' : 'Report content'} disabled={reportedByMe || report.isPending} onPress={() => { setOpen((current) => !current); setMessage(''); }}>
      <Ionicons name={reportedByMe || message === 'Report sent' ? 'flag' : 'flag-outline'} size={18} color={c.mutedForeground} />
    </Pressable>
    {open && <View style={{ position: 'absolute', zIndex: 5, top: 25, right: 0, width: 220, padding: 10, gap: 4, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
      <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 3 }}>Report reason</Text>
      {reportCategories.map((category) => <Pressable key={category.value} accessibilityRole="button" onPress={() => submit(category.value)} style={{ minHeight: 38, justifyContent: 'center', paddingHorizontal: 7, borderTopWidth: 1, borderTopColor: c.border }}>
        <Text style={{ color: c.foreground, fontSize: 12 }}>{category.label}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ minHeight: 34, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: c.mutedForeground, fontSize: 12 }}>Cancel</Text></Pressable>
    </View>}
    {!!message && <Text accessibilityRole="alert" style={{ maxWidth: 150, color: message.toLowerCase().includes('reported') ? c.primary : c.destructive, fontSize: 10 }}>{message}</Text>}
  </View>;
}

function CommentRow({
  comment,
  walletAddress,
  onChanged,
}: {
  comment: TimelineComment;
  walletAddress: string;
  onChanged: () => void;
}) {
  const c = useColors();
  const client = useQueryClient();
  const own = comment.authorAddress === walletAddress;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState('');
  const update = useUpdateTimelineComment();
  const remove = useDeleteTimelineComment();
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: getListTimelineCommentsQueryKey(comment.postId) });
    void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
  };
  const deleteComment = () => Alert.alert('Remove reply?', 'This will remove your reply from the public timeline.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => remove.mutate({ postId: comment.postId, commentId: comment.id }, { onSuccess: () => { invalidate(); onChanged(); }, onError: (cause) => setError(errorText(cause)) }) },
  ]);

  return <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 7 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', flex: 1 }}>{comment.authorUsername ? `@${comment.authorUsername}` : shortAddress(comment.authorAddress)}</Text>
      <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{ageLabel(comment.createdAt)}</Text>
      {own ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit reply" onPress={() => { setDraft(comment.body); setEditing((value) => !value); setError(''); }}><Ionicons name="create-outline" size={18} color={c.mutedForeground} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove reply" onPress={deleteComment}><Ionicons name="trash-outline" size={17} color={c.destructive} /></Pressable>
      </> : <ReportMenu subjectType="comment" subjectId={comment.id} postId={comment.postId} reportedByMe={comment.reportedByMe} onReported={invalidate} />}
    </View>
    {editing ? <>
      <Field accessibilityLabel="Edit your reply" multiline value={draft} onChangeText={setDraft} maxLength={COMMENT_LIMIT} style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Button secondary title="Cancel" onPress={() => setEditing(false)} /></View><View style={{ flex: 1 }}><Button title={update.isPending ? 'Saving…' : 'Save reply'} disabled={!draft.trim()} busy={update.isPending} onPress={() => update.mutate({ postId: comment.postId, commentId: comment.id, data: { body: draft.trim() } }, { onSuccess: () => { setEditing(false); invalidate(); }, onError: (cause) => setError(errorText(cause)) })} /></View></View>
    </> : <Text style={{ color: c.foreground, lineHeight: 20 }}>{comment.body}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.destructive, fontSize: 12 }}>{error}</Text>}
  </View>;
}

function PostCard({
  post,
  walletAddress,
  onUpdate,
  onDelete,
}: {
  post: TimelinePost;
  walletAddress: string;
  onUpdate: (id: string, update: Partial<TimelinePost>) => void;
  onDelete: (id: string) => void;
}) {
  const c = useColors();
  const client = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCursor, setCommentCursor] = useState<string | undefined>();
  const [comments, setComments] = useState<TimelineComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState(post.body);
  const [error, setError] = useState('');
  const params = { cursor: commentCursor, limit: 15 };
  const commentsQuery = useListTimelineComments(post.id, params, {
    query: { enabled: commentsOpen, queryKey: getListTimelineCommentsQueryKey(post.id, params) },
  });
  const createComment = useCreateTimelineComment();
  const like = useLikeTimelinePost();
  const unlike = useUnlikeTimelinePost();
  const update = useUpdateTimelinePost();
  const remove = useDeleteTimelinePost();

  useEffect(() => {
    if (!commentsQuery.data) return;
    setComments((current) => {
      const existing = new Set(current.map((item) => item.id));
      const incoming = commentsQuery.data.items.filter((item) => !existing.has(item.id));
      return commentCursor ? [...current, ...incoming] : incoming;
    });
  }, [commentsQuery.data, commentCursor]);

  const refreshPosts = () => {
    void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
  };
  const updatePost = (changes: Partial<TimelinePost>) => onUpdate(post.id, changes);
  const deletePost = () => Alert.alert('Remove post?', 'This will remove your post and its replies from the public timeline.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => remove.mutate({ postId: post.id }, { onSuccess: () => { refreshPosts(); onDelete(post.id); }, onError: (cause) => setError(errorText(cause)) }) },
  ]);

  return <Panel style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: c.muted, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.primary, fontFamily: 'Inter_700Bold' }}>{post.authorAddress.slice(0, 2).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>{post.authorUsername ? `@${post.authorUsername}` : shortAddress(post.authorAddress)}{post.authorAddress === walletAddress ? ' · you' : ''}</Text>
        {post.authorUsername ? <Text style={{ color: c.mutedForeground, fontSize: 10 }}>{shortAddress(post.authorAddress)}</Text> : null}
      </View>
      <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{ageLabel(post.createdAt)}</Text>
      {post.authorAddress === walletAddress
        ? <Pressable accessibilityRole="button" accessibilityLabel="More post actions" onPress={() => Alert.alert('Your post', undefined, [
          { text: 'Edit', onPress: () => { setEditDraft(post.body); setEditOpen(true); } },
          { text: 'Remove', style: 'destructive', onPress: deletePost },
          { text: 'Cancel', style: 'cancel' },
        ])}><Ionicons name="ellipsis-horizontal" size={20} color={c.mutedForeground} /></Pressable>
        : <ReportMenu subjectType="post" subjectId={post.id} reportedByMe={post.reportedByMe} onReported={refreshPosts} />}
    </View>
    {editOpen ? <View style={{ gap: 8 }}>
      <Field accessibilityLabel="Edit your post" multiline value={editDraft} onChangeText={setEditDraft} maxLength={POST_LIMIT} style={{ minHeight: 110, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Button secondary title="Cancel" onPress={() => setEditOpen(false)} /></View><View style={{ flex: 1 }}><Button title={update.isPending ? 'Saving…' : 'Save post'} busy={update.isPending} disabled={!editDraft.trim()} onPress={() => update.mutate({ postId: post.id, data: { body: editDraft.trim() } }, { onSuccess: () => { updatePost({ body: editDraft.trim() }); setEditOpen(false); refreshPosts(); }, onError: (cause) => setError(errorText(cause)) })} /></View></View>
    </View> : <Text style={{ color: c.foreground, fontSize: 15, lineHeight: 23 }}>{post.body}</Text>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={post.likedByMe ? 'Unlike post' : 'Like post'} disabled={like.isPending || unlike.isPending} onPress={() => (post.likedByMe ? unlike : like).mutate({ postId: post.id }, { onSuccess: (result) => { updatePost({ likeCount: result.likeCount, likedByMe: result.likedByMe }); refreshPosts(); void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() }); void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() }); } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={post.likedByMe ? 'heart' : 'heart-outline'} size={19} color={post.likedByMe ? c.secondary : c.mutedForeground} /><Text style={{ color: post.likedByMe ? c.secondary : c.mutedForeground }}>{post.likeCount}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={commentsOpen ? 'Hide replies' : 'Show replies'} onPress={() => { const next = !commentsOpen; setCommentsOpen(next); if (!next) { setComments([]); setCommentCursor(undefined); } }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={c.mutedForeground} /><Text style={{ color: c.mutedForeground }}>{post.commentCount}</Text>
      </Pressable>
      {post.authorAddress === walletAddress && <Pressable accessibilityRole="button" accessibilityLabel="Remove post" onPress={deletePost} style={{ marginLeft: 'auto' }}><Ionicons name="trash-outline" size={17} color={c.mutedForeground} /></Pressable>}
    </View>
    {commentsOpen && <View style={{ gap: 10 }}>
      {commentsQuery.isLoading && comments.length === 0 ? <ActivityIndicator color={c.primary} /> : null}
      {comments.map((comment) => <CommentRow key={comment.id} comment={comment} walletAddress={walletAddress} onChanged={() => updatePost({ commentCount: Math.max(0, post.commentCount - 1) })} />)}
      {commentsQuery.data?.nextCursor ? <Button secondary title="Load older replies" disabled={commentsQuery.isFetching} onPress={() => setCommentCursor(commentsQuery.data?.nextCursor ?? undefined)} /> : null}
      <View style={{ gap: 8 }}>
        <Field accessibilityLabel="Write a reply" placeholder="Add to the thread…" value={commentDraft} onChangeText={setCommentDraft} maxLength={COMMENT_LIMIT} multiline style={{ minHeight: 76, textAlignVertical: 'top' }} />
        <Button title={createComment.isPending ? 'Sending…' : 'Reply'} busy={createComment.isPending} disabled={!commentDraft.trim()} onPress={() => {
          const body = commentDraft.trim();
          setError('');
          createComment.mutate({ postId: post.id, data: { body } }, { onSuccess: () => { setCommentDraft(''); setComments([]); setCommentCursor(undefined); updatePost({ commentCount: post.commentCount + 1 }); void client.invalidateQueries({ queryKey: getListTimelineCommentsQueryKey(post.id) }); void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() }); void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() }); }, onError: (cause) => setError(errorText(cause)) });
        }} />
      </View>
    </View>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.destructive, fontSize: 12 }}>{error}</Text>}
  </Panel>;
}

export function MobileTimelineScreen({ walletAddress }: { walletAddress: string }) {
  const c = useColors();
  const client = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>();
  const [pages, setPages] = useState<Array<{ cursor?: string; items: TimelinePost[] }>>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const params = { cursor, limit: 20 };
  const postsQuery = useListTimelinePosts(params, { query: { queryKey: getListTimelinePostsQueryKey(params), refetchInterval: 30_000 } });
  const createPost = useCreateTimelinePost();
  useEffect(() => {
    if (!postsQuery.data) return;
    setPages((current) => {
      const index = current.findIndex((page) => page.cursor === cursor);
      const next = [...current];
      if (index < 0) next.push({ cursor, items: postsQuery.data.items });
      else next[index] = { cursor, items: postsQuery.data.items };
      return next;
    });
  }, [postsQuery.data, cursor]);
  const posts = pages.length ? pages.flatMap((page) => page.items) : postsQuery.data?.items ?? [];
  const updatePost = (id: string, changes: Partial<TimelinePost>) => setPages((current) => current.map((page) => ({ ...page, items: page.items.map((post) => post.id === id ? { ...post, ...changes } : post) })));
  const deletePost = (id: string) => setPages((current) => current.map((page) => ({ ...page, items: page.items.filter((post) => post.id !== id) })));
  const publish = () => {
    const body = draft.trim();
    if (!body) return;
    setError('');
    createPost.mutate({ data: { body } }, { onSuccess: () => {
      setDraft(''); setCursor(undefined); setPages([]);
      void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetGamificationSummaryQueryKey() });
      void client.invalidateQueries({ queryKey: getGetGamificationLeaderboardQueryKey() });
    }, onError: (cause) => setError(errorText(cause)) });
  };
  const header = <View style={{ paddingBottom: 12, gap: 12 }}>
    <View><Text style={{ color: c.primary, fontSize: 10, letterSpacing: 1.4, fontFamily: 'Inter_600SemiBold' }}>$HERMIT COMMUNITY · PUBLIC FEED</Text><Text style={{ color: c.foreground, fontFamily: 'Inter_700Bold', fontSize: 26, letterSpacing: -0.8, marginTop: 4 }}>Frogtown feed.</Text></View>
    <Panel>
      <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold' }}>What’s happening in Frogtown?</Text>
      <Field accessibilityLabel="Write a public post" placeholder="Share a thought with the neighborhood…" value={draft} onChangeText={(value) => { setDraft(value); setError(''); }} multiline maxLength={POST_LIMIT} style={{ minHeight: 104, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: c.mutedForeground, fontSize: 11 }}>{draft.length}/{POST_LIMIT}</Text><View style={{ minWidth: 130 }}><Button title={createPost.isPending ? 'Posting…' : 'Post to timeline'} busy={createPost.isPending} disabled={!draft.trim()} onPress={publish} /></View></View>
      {!!error && <Text accessibilityRole="alert" style={{ color: c.destructive, fontSize: 12 }}>{error}</Text>}
    </Panel>
    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>Public posts · be kind to your neighbors</Text>
  </View>;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
    <FlatList
      data={posts}
      keyExtractor={(post) => post.id}
      renderItem={({ item }) => <PostCard post={item} walletAddress={walletAddress} onUpdate={updatePost} onDelete={deletePost} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, gap: 12 }}
      ListHeaderComponent={header}
      ListEmptyComponent={postsQuery.isLoading ? <ActivityIndicator color={c.primary} /> : <Panel><Label muted>The timeline is quiet for now. Start the conversation.</Label></Panel>}
      ListFooterComponent={postsQuery.data?.nextCursor ? <Button secondary title={postsQuery.isFetching ? 'Loading…' : 'Load older posts'} disabled={postsQuery.isFetching} onPress={() => setCursor(postsQuery.data?.nextCursor ?? undefined)} /> : null}
      refreshControl={<RefreshControl refreshing={postsQuery.isRefetching} onRefresh={() => void postsQuery.refetch()} tintColor={c.primary} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      onEndReachedThreshold={0.3}
      onEndReached={() => {
        if (postsQuery.data?.nextCursor && !postsQuery.isFetching && cursor === pages.at(-1)?.cursor) {
          setCursor(postsQuery.data.nextCursor);
        }
      }}
    />
    {postsQuery.error && <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><Label>{errorText(postsQuery.error)}</Label></View>}
  </KeyboardAvoidingView>;
}
