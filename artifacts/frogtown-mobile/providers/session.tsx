import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import {
  createMobileAuthRequest, exchangeMobileAuthRequest, getCurrentWallet,
  getWalletHermitTick, revokeMobilePushDevice,
} from '@workspace/api-client-react';
import { apiOrigin, setSessionToken, errorText, statusOf } from '../lib/api';
import { canonicalKey, pkceChallenge, randomSecret, type Identity } from '../lib/crypto';
import { ensureIdentity, RecoveryRequired } from '../lib/identity';
import { readSecure, writeSecure, removeSecure } from '../lib/storage';
import { clearChatState } from '../lib/outbox';

type Session = { token: string; walletAddress: string; expiresAt: string };
type Pending = { requestId: string; codeVerifier: string; expiresAt: string; loginUrl: string };
type Value = {
  wallet: string; identity: Identity | null; loading: boolean; pending: Pending | null;
  error: string; recovery: boolean; beginSignIn: () => Promise<void>; checkSignIn: () => Promise<void>;
  cancelSignIn: () => Promise<void>; signOut: () => Promise<void>; refreshIdentity: () => Promise<void>;
};
const Context = createContext<Value | null>(null);
const SESSION_KEY = 'frogtown.native.session';
const PENDING_KEY = 'frogtown.native.signin';
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [wallet, setWallet] = useState('');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  const busy = useRef(false);
  const identityGeneration = useRef(0);
  const currentIdentityKey = useRef('');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => listener.remove();
  }, []);
  const refreshIdentity = useCallback(async () => {
    if (!wallet) return;
    const generation = ++identityGeneration.current;
    try {
      const next = await ensureIdentity(wallet);
      if (generation !== identityGeneration.current) return;
      if (currentIdentityKey.current && currentIdentityKey.current !== canonicalKey(next.publicJwk)) {
        client.removeQueries({ predicate: (q) => q.queryKey[0] === 'mobile' });
        await clearChatState(wallet);
      }
      if (generation !== identityGeneration.current) return;
      currentIdentityKey.current = canonicalKey(next.publicJwk);
      setIdentity(next); setRecovery(false); setError('');
    } catch (cause) {
      if (generation !== identityGeneration.current) return;
      setIdentity(null);
      client.removeQueries({ predicate: (q) => q.queryKey[0] === 'mobile' });
      if (cause instanceof RecoveryRequired) { await clearChatState(wallet); setRecovery(true); }
      setError(errorText(cause));
    }
  }, [wallet, client]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stored, awaiting] = await Promise.all([readSecure(SESSION_KEY), readSecure(PENDING_KEY)]);
        if (awaiting && !cancelled) { pendingRef.current = JSON.parse(awaiting); setPending(pendingRef.current); }
        if (stored) {
          const session = JSON.parse(stored) as Session;
          if (Date.parse(session.expiresAt) <= Date.now()) { await removeSecure(SESSION_KEY); return; }
          setSessionToken(session.token);
          try {
            const verified = await getCurrentWallet();
            if (verified.walletAddress !== session.walletAddress) {
              setSessionToken(null); await removeSecure(SESSION_KEY);
              throw Object.assign(new Error('The stored wallet session no longer matches.'), { status: 401 });
            }
          } catch (cause) {
            if (statusOf(cause) === 401) { setSessionToken(null); await removeSecure(SESSION_KEY); throw cause; }
            // Network failure does not destroy the session or encryption key.
            setError('Could not verify your session. Reconnect and try again.');
          }
          if (!cancelled) setWallet(session.walletAddress);
        }
      } catch (cause) { if (!cancelled) setError(errorText(cause)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!wallet) return;
    void refreshIdentity();
    void getWalletHermitTick(wallet, { refresh: true }).catch(() => {});
    const interval = setInterval(() => { if (AppState.currentState === 'active') void refreshIdentity(); }, 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        ++identityGeneration.current; setIdentity(null);
        client.removeQueries({ predicate: (q) => q.queryKey[0] === 'mobile' && q.queryKey[1] === 'messages' });
      } else { void refreshIdentity(); void client.invalidateQueries({ queryKey: ['mobile'] }); }
    });
    return () => { clearInterval(interval); subscription.remove(); ++identityGeneration.current; };
  }, [wallet, refreshIdentity, client]);

  const cancelSignIn = useCallback(async () => {
    pendingRef.current = null;
    await removeSecure(PENDING_KEY); setPending(null); setError('');
  }, []);
  const checkSignIn = useCallback(async () => {
    if (!pending || busy.current) return;
    busy.current = true;
    try {
      if (Date.parse(pending.expiresAt) < Date.now()) { await cancelSignIn(); throw new Error('Sign-in expired. Start again.'); }
      const result = await exchangeMobileAuthRequest({ requestId: pending.requestId, codeVerifier: pending.codeVerifier });
      if (result.status === 'connected') {
        if (pendingRef.current?.requestId !== pending.requestId) return;
        if (!result.token || !result.walletAddress || !result.expiresAt) throw new Error('The sign-in response was incomplete.');
        const session: Session = { token: result.token, walletAddress: result.walletAddress, expiresAt: result.expiresAt };
        await writeSecure(SESSION_KEY, JSON.stringify(session));
        if (pendingRef.current?.requestId !== pending.requestId) { await removeSecure(SESSION_KEY); return; }
        setSessionToken(session.token);
        client.clear(); setWallet(session.walletAddress);
        await cancelSignIn();
      }
    } catch (cause) { setError(errorText(cause)); if (statusOf(cause) === 410) { await removeSecure(PENDING_KEY); setPending(null); } }
    finally { busy.current = false; }
  }, [pending, client, cancelSignIn]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void checkSignIn(); }, 2500);
    const resume = AppState.addEventListener('change', (state) => { if (state === 'active') void checkSignIn(); });
    const link = Linking.addEventListener('url', () => { WebBrowser.dismissBrowser(); void checkSignIn(); });
    void checkSignIn();
    return () => { clearInterval(timer); resume.remove(); link.remove(); };
  }, [pending, checkSignIn]);
  const beginSignIn = async () => {
    if (!apiOrigin) throw new Error('Set EXPO_PUBLIC_API_URL before building Frogtown Mobile.');
    setError('');
    const codeVerifier = randomSecret(Crypto.getRandomBytes);
    const result = await createMobileAuthRequest({ codeChallenge: pkceChallenge(codeVerifier) });
    const loginUrl = new URL(result.loginPath, apiOrigin).toString();
    if (new URL(loginUrl).origin !== apiOrigin) throw new Error('The wallet sign-in URL was invalid.');
    const next = { requestId: result.requestId, expiresAt: result.expiresAt, codeVerifier, loginUrl };
    await writeSecure(PENDING_KEY, JSON.stringify(next)); pendingRef.current = next; setPending(next);
    await WebBrowser.openBrowserAsync(loginUrl);
  };
  const signOut = async () => {
    const device = await readSecure(`frogtown.push.${wallet}`);
    if (device) {
      try { await revokeMobilePushDevice(device); }
      catch (cause) { if (statusOf(cause) !== 401) throw cause; }
      await removeSecure(`frogtown.push.${wallet}`);
    }
    ++identityGeneration.current;
    await removeSecure(SESSION_KEY); identityGeneration.current += 1; setSessionToken(null); client.clear();
    currentIdentityKey.current = '';
    setWallet(''); setIdentity(null); setRecovery(false); setError('');
  };
  return <Context.Provider value={{ wallet, identity, loading, pending, error, recovery, beginSignIn, checkSignIn, cancelSignIn, signOut, refreshIdentity }}>{children}</Context.Provider>;
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider is missing.');
  return value;
}
