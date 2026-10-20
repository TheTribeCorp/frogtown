import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

const configured = process.env.EXPO_PUBLIC_API_URL
  || (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');
export const apiOrigin = configured ? new URL(configured).origin : '';
if (apiOrigin && !apiOrigin.startsWith('https://')) throw new Error('Frogtown Mobile requires an HTTPS API origin.');
setBaseUrl(apiOrigin || null);
let token: string | null = null;
setAuthTokenGetter(() => token);
export function setSessionToken(value: string | null) { token = value; }
export function errorText(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.'; }
export function statusOf(error: unknown) { return Number((error as { status?: number })?.status); }
