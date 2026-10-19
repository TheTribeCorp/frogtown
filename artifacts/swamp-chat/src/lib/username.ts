import { z } from 'zod';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

export const usernameSchema = z.object({
  username: z.string()
    .trim()
    .min(4, 'Use at least 4 characters.')
    .max(17, 'Use no more than 17 characters.')
    .regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers, and underscores only.'),
});

export type UsernameFormValues = z.infer<typeof usernameSchema>;

// Resolver's current peer typing resolves to Zod 4 while the workspace schema is Zod 3.
// The runtime resolver uses safeParse and supports this Zod 3 schema.
export const usernameFormResolver = zodResolver(usernameSchema as never) as unknown as Resolver<UsernameFormValues>;

export function usernameSaveErrorMessage(error: unknown) {
  const apiError = error as { status?: number; data?: { error?: string } };
  if (apiError.status === 409) return 'That username is already taken. Try another.';
  return apiError.data?.error ?? 'Could not save your username. Please try again.';
}
