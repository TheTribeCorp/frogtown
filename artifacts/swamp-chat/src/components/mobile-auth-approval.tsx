import { useEffect, useState, type ReactNode } from 'react';
import { approveMobileAuthRequest } from '@workspace/api-client-react';

export function MobileAuthApprovalGate({ walletAddress, onChangeWallet, children }: { walletAddress: string; onChangeWallet: () => void; children: ReactNode }) {
  const [requestId] = useState(() => new URL(window.location.href).searchParams.get('mobileRequest') || window.sessionStorage.getItem('frogtown-mobile-auth-request'));
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (requestId && /^[0-9a-f-]{36}$/i.test(requestId)) window.sessionStorage.setItem('frogtown-mobile-auth-request', requestId);
  }, [requestId]);
  if (!requestId || !walletAddress) return <>{children}</>;
  const valid = /^[0-9a-f-]{36}$/i.test(requestId);
  return (
    <main className="swamp-app flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6 text-[hsl(var(--foreground))]">
      <section className="w-full max-w-md rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-xl">
        <p className="text-xs uppercase tracking-widest text-[hsl(var(--primary))]">Frogtown Mobile</p>
        <h1 className="my-4 text-3xl font-semibold">{approved ? 'Your app is connected.' : 'Sign in on your phone?'}</h1>
        <p className="break-all text-sm text-[hsl(var(--muted-foreground))]">{walletAddress}</p>
        <p className="my-5 text-sm">{approved ? 'Return to the Frogtown app. Your chat encryption key stays on your own device.' : 'Only approve if you just started sign-in from Frogtown Mobile. This gives that app access to your Frogtown account, not permission to spend tokens.'}</p>
        {error && <p role="alert" className="my-4 text-sm text-red-600">{error}</p>}
        {approved ? <a href="frogtown://auth" className="block rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-center text-[hsl(var(--primary-foreground))]">Return to Frogtown Mobile</a> : <button data-testid="approve-mobile-signin" disabled={busy || !valid} className="w-full rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-[hsl(var(--primary-foreground))] disabled:opacity-50" onClick={async () => {
          setBusy(true); setError('');
          try { await approveMobileAuthRequest(requestId); window.sessionStorage.removeItem('frogtown-mobile-auth-request'); setApproved(true); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in could not be approved.'); }
          finally { setBusy(false); }
        }}>{busy ? 'Approving…' : 'Approve mobile sign-in'}</button>}
        <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Using Expo Go? Switch back to Expo Go manually after approval.</p>
        {!approved && <button onClick={onChangeWallet} className="mt-4 w-full text-sm underline">Use a different wallet</button>}
        <a href={import.meta.env.BASE_URL} onClick={() => window.sessionStorage.removeItem('frogtown-mobile-auth-request')} className="mt-5 block text-center text-sm underline">Cancel and use the website</a>
      </section>
    </main>
  );
}
