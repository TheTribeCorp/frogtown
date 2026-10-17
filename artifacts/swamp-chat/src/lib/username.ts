import { z } from 'zod';

export const usernameSchema = z.object({
  username: z.string()
    .trim()
    .min(4, 'Use at least 4 characters.')
    .max(17, 'Use no more than 17 characters.')
    .regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers, and underscores only.'),
});

export type UsernameFormValues = z.infer<typeof usernameSchema>;

export function usernameSaveErrorMessage(error: unknown) {
  const apiError = error as { status?: number; data?: { error?: string } };
  if (apiError.status === 409) return 'That username is already taken. Try another.';
  return apiError.data?.error ?? 'Could not save your username. Please try again.';
}
