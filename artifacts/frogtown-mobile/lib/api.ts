import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
const browserOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
  ? window.location.origin
  : '';
const developmentOrigin = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : process.env.EXPO_PUBLIC_API_URL || '';
const releaseOrigin = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.productionApiOrigin || '';
const apiConfigured = browserOrigin || (isDevelopment ? developmentOrigin : releaseOrigin);
const authConfigured = isDevelopment ? developmentOrigin : releaseOrigin;
export const apiOrigin = apiConfigured ? new URL(apiConfigured).origin : '';
export const walletAuthOrigin = authConfigured ? new URL(authConfigured).origin : '';
if (apiOrigin && !apiOrigin.startsWith('https://')) throw new Error('Frogtown Mobile requires an HTTPS API origin.');
if (walletAuthOrigin && !walletAuthOrigin.startsWith('https://')) throw new Error('Frogtown Mobile requires an HTTPS wallet sign-in origin.');
if (!isDevelopment && (!apiOrigin || !walletAuthOrigin)) throw new Error('Frogtown Mobile production builds require a configured HTTPS API origin.');
setBaseUrl(apiOrigin || null);
let token: string | null = null;
setAuthTokenGetter(() => token);
export function setSessionToken(value: string | null) { token = value; }
export function errorText(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.'; }
export function statusOf(error: unknown) { return Number((error as { status?: number })?.status); }
