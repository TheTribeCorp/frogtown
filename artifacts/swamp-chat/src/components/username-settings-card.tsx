import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  getGetWalletProfileQueryKey,
  useGetWalletProfile,
  useSaveWalletUsername,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { getReferralInstallationId } from '@/lib/referral-installation';
import { usernameSchema, usernameSaveErrorMessage, type UsernameFormValues } from '@/lib/username';

export function UsernameSettingsCard({ walletAddress }: { walletAddress: string }) {
  const queryClient = useQueryClient();
  const profileQueryKey = [...getGetWalletProfileQueryKey(), walletAddress];
  const profileQuery = useGetWalletProfile({
    query: {
      enabled: Boolean(walletAddress),
      queryKey: profileQueryKey,
      retry: false,
    },
    request: { credentials: 'same-origin' },
  });
  const saveUsername = useSaveWalletUsername({
    request: { credentials: 'same-origin' },
  });
  const [notice, setNotice] = useState('');
  const form = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: '' },
    mode: 'onChange',
  });

  useEffect(() => {
    if (profileQuery.data) {
      form.reset({ username: profileQuery.data.username ?? '' });
    }
  }, [form, profileQuery.data?.username]);

  const submit = form.handleSubmit(({ username }) => {
    setNotice('');
    saveUsername.mutate(
      { data: { username: username.toLowerCase(), deviceId: getReferralInstallationId() ?? undefined } },
      {
        onSuccess: (profile) => {
          queryClient.setQueryData(profileQueryKey, profile);
          form.reset({ username: profile.username ?? '' });
          setNotice('Your username is updated across Frogtown.');
          void queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
          void queryClient.invalidateQueries({ queryKey: ['/api/timeline/posts'] });
          void queryClient.invalidateQueries({ queryKey: getGetWalletProfileQueryKey() });
          void queryClient.invalidateQueries({ queryKey: ['/api/gamification/leaderboard'] });
        },
        onError: (error) => {
          form.setError('username', { type: 'server', message: usernameSaveErrorMessage(error) });
        },
      },
    );
  });

  return (
    <section className="rounded-[1.25rem] border border-[hsl(var(--primary)/.18)] bg-[hsl(var(--card)/.82)] p-5 shadow-[0_10px_28px_hsl(155_27%_15%/.035)] md:p-6" data-testid="card-username-settings">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-sm font-semibold text-[hsl(var(--primary))]">@</div>
        <div className="min-w-0 flex-1">
          <p className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Your public name</p>
          <h3 className="mt-1 text-lg font-semibold tracking-[-.03em]">Frogtown username</h3>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
            Members can find you by this username or your wallet address.
          </p>
        </div>
      </div>

      {profileQuery.isError ? (
        <div className="mt-4 rounded-lg border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.05)] p-3" role="alert" data-testid="error-username-settings-load">
          <p className="text-xs text-[hsl(var(--destructive))]">Your username could not be loaded.</p>
          <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 px-2" onClick={() => void profileQuery.refetch()} data-testid="button-retry-username-settings">Try again</Button>
        </div>
      ) : (
        <Form {...form}>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <div className="flex items-center rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-3 focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.2)]">
                      <span className="text-sm text-[hsl(var(--muted-foreground))]">@</span>
                      <Input
                        {...field}
                        autoComplete="username"
                        maxLength={17}
                        placeholder="yourname"
                        className="border-0 bg-transparent focus-visible:ring-0"
                        disabled={profileQuery.isLoading}
                        data-testid="input-settings-username"
                      />
                    </div>
                  </FormControl>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">4–17 characters · letters, numbers, or underscores</p>
                  <FormMessage data-testid="error-settings-username" />
                </FormItem>
              )}
            />
            {notice && <p className="text-xs text-[hsl(var(--primary))]" role="status" data-testid="status-username-updated">{notice}</p>}
            <Button
              type="submit"
              disabled={profileQuery.isLoading || !form.formState.isValid || !form.formState.isDirty || saveUsername.isPending}
              data-testid="button-update-username"
            >
              {saveUsername.isPending ? 'Saving…' : 'Update username'}
            </Button>
          </form>
        </Form>
      )}
    </section>
  );
}
