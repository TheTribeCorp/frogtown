import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react';
import {
  getListTimelineCommentsQueryKey,
  getListTimelinePostsQueryKey,
  useDeleteTimelineComment,
  useDeleteTimelinePost,
  useUpdateTimelineComment,
  useUpdateTimelinePost,
} from '@workspace/api-client-react';

type Props = {
  subjectType: 'post' | 'comment';
  subjectId: string;
  postId: string;
  body: string;
  onDeleted: () => void;
};

export function TimelineOwnerActions({ subjectType, subjectId, postId, body, onDeleted }: Props) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(body);
  const [error, setError] = useState('');
  const updatePost = useUpdateTimelinePost();
  const deletePost = useDeleteTimelinePost();
  const updateComment = useUpdateTimelineComment();
  const deleteComment = useDeleteTimelineComment();
  const pending = updatePost.isPending || deletePost.isPending || updateComment.isPending || deleteComment.isPending;
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: getListTimelinePostsQueryKey() });
    if (subjectType === 'comment') {
      void client.invalidateQueries({ queryKey: getListTimelineCommentsQueryKey(postId) });
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextBody = draft.trim();
    if (!nextBody) {
      setError('A post or reply cannot be empty.');
      return;
    }
    setError('');
    const onSuccess = () => {
      setEditing(false);
      invalidate();
    };
    const onError = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Your changes could not be saved.');
    if (subjectType === 'post') {
      updatePost.mutate({ postId: subjectId, data: { body: nextBody } }, { onSuccess, onError });
    } else {
      updateComment.mutate({ postId, commentId: subjectId, data: { body: nextBody } }, { onSuccess, onError });
    }
  };

  const remove = () => {
    setError('');
    const onSuccess = () => {
      invalidate();
      onDeleted();
    };
    const onError = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'This content could not be removed.');
    if (subjectType === 'post') {
      deletePost.mutate({ postId: subjectId }, { onSuccess, onError });
    } else {
      deleteComment.mutate({ postId, commentId: subjectId }, { onSuccess, onError });
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="mt-3 rounded-xl border border-[hsl(var(--primary)/.22)] bg-[hsl(var(--background)/.75)] p-3" data-testid={`form-edit-${subjectType}-${subjectId}`}>
        <label htmlFor={`edit-${subjectType}-${subjectId}`} className="sr-only">Edit your {subjectType}</label>
        <textarea
          id={`edit-${subjectType}-${subjectId}`}
          autoFocus
          value={draft}
          maxLength={subjectType === 'post' ? 5000 : 2000}
          onChange={(event) => { setDraft(event.target.value); setError(''); }}
          rows={subjectType === 'post' ? 4 : 3}
          className="w-full resize-y rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]"
          data-testid={`input-edit-${subjectType}-${subjectId}`}
        />
        {error && <p className="mt-2 text-xs text-[hsl(var(--destructive))]" role="alert">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => { setDraft(body); setEditing(false); setError(''); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid={`button-cancel-edit-${subjectType}-${subjectId}`}><X className="size-3.5" /> Cancel</button>
          <button type="submit" disabled={pending || !draft.trim()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid={`button-save-edit-${subjectType}-${subjectId}`}>{pending ? <RefreshCw className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save changes</button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {error && <p role="alert" className="mr-auto w-full text-right text-[10px] text-[hsl(var(--destructive))]">{error}</p>}
      {confirming ? (
        <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-lg bg-[hsl(var(--destructive)/.06)] px-2 py-2" role="group" aria-label={`Confirm removal of your ${subjectType}`}>
          <span className="mr-auto text-[10px] text-[hsl(var(--destructive))]">Remove this {subjectType}?</span>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="rounded-md px-2.5 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid={`button-cancel-delete-${subjectType}-${subjectId}`}>Keep it</button>
          <button type="button" onClick={remove} disabled={pending} className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--destructive))] px-2.5 py-1.5 text-[10px] font-medium text-[hsl(var(--destructive-foreground))] disabled:opacity-55" data-testid={`button-confirm-delete-${subjectType}-${subjectId}`}>{pending ? <RefreshCw className="size-3 animate-spin" /> : <Trash2 className="size-3" />} Remove</button>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => { setDraft(body); setEditing(true); setError(''); }} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--primary)/.08)] hover:text-[hsl(var(--primary))]" data-testid={`button-edit-${subjectType}-${subjectId}`}><Pencil className="size-3" /> Edit</button>
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]" data-testid={`button-delete-${subjectType}-${subjectId}`}><Trash2 className="size-3" /> Remove</button>
        </>
      )}
    </div>
  );
}
