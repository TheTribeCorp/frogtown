import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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
import { HermitTick } from '@/components/hermit-tick';
import { usernameSchema, usernameSaveErrorMessage, type UsernameFormValues } from '@/lib/username';

function shortWallet(address: string) {
  return address.length > 15 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;
}

function saveErrorMessage(error: unknown) {
  const apiError = error as { status?: number; data?: { error?: string } };
  if (apiError.status === 409) return 'That username is already taken. Try another.';
  return apiError.data?.error ?? 'Could not save your username. Please try again.';
}

export function UsernameOnboardingGate({
  walletAddress,
  children,
}: {
  walletAddress: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const profileQueryKey = [...getGetWalletProfileQueryKey(), walletAddress];
  const profileQuery = useGetWalletProfile({
    query: {
      enabled: Boolean(walletAddress),
      queryKey: profileQueryKey,
      retry: false,
      refetchOnMount: 'always',
    },
    request: { credentials: 'same-origin' },
  });
  const saveUsername = useSaveWalletUsername({
    request: { credentials: 'same-origin' },
  });
  const form = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: '' },
    mode: 'onChange',
  });

  useEffect(() => {
    if (profileQuery.data?.username) {
      window.sessionStorage.removeItem('frogtown-referrer-wallet');
    }
  }, [profileQuery.data?.username]);

  if (!walletAddress) return children;

  if (profileQuery.isLoading) {
    return (
      <main className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-6">
        <p className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.85)] px-5 py-4 text-sm text-[hsl(var(--muted-foreground))]" role="status" data-testid="status-loading-profile">
          Checking your Frogtown username…
        </p>
      </main>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <main className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-5">
        <section className="w-full max-w-md rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.9)] p-6 shadow-xl">
          <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Frogtown profile</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Couldn’t load your username</h1>
          <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]" role="alert" data-testid="error-load-profile">
            Check your connection and try again. Your wallet session is {shortWallet(walletAddress)}.
          </p>
          <Button className="mt-5 w-full" onClick={() => void profileQuery.refetch()} data-testid="button-retry-profile">
            Try again
          </Button>
        </section>
      </main>
    );
  }

  if (profileQuery.data.username) return children;

  return (
    <main className="swamp-app noise flex min-h-[100dvh] items-center justify-center p-5">
      <section className="w-full max-w-md rounded-[1.6rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.94)] p-6 shadow-xl sm:p-8">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">
          <span className="mono text-xl font-semibold">@</span>
        </div>
        <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">One wallet · one name</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Choose your username</h1>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Your community can find and message you with this name or your XRPL wallet address.
        </p>
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          Signed in as <span className="mono">{shortWallet(walletAddress)}</span>{' '}
          <HermitTick walletAddress={walletAddress} currentWallet className="inline-flex size-4 align-middle" />
        </p>

        <Form {...form}>
          <form
            className="mt-6 space-y-4"
            onSubmit={form.handleSubmit(({ username }) => {
              const referrerAddress = window.sessionStorage.getItem('frogtown-referrer-wallet') ?? undefined;
              saveUsername.mutate(
                { data: { username: username.toLowerCase(), referrerAddress } },
                {
                  onSuccess: (profile) => {
                    queryClient.setQueryData(profileQueryKey, profile);
                    window.sessionStorage.removeItem('frogtown-referrer-wallet');
                  },
                  onError: (error) => {
                    form.setError('username', { type: 'server', message: usernameSaveErrorMessage(error) });
                  },
                },
              );
            })}
          >
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
                        data-testid="input-username"
                      />
                    </div>
                  </FormControl>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">4–17 characters · letters, numbers, or underscores</p>
                  <FormMessage data-testid="error-username" />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={!form.formState.isValid || saveUsername.isPending}
              className="w-full"
              data-testid="button-save-username"
            >
              {saveUsername.isPending ? 'Saving…' : 'Continue to Frogtown'}
            </Button>
          </form>
        </Form>
      </section>
    </main>
  );
}
