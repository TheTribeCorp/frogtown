import './_group.css';

function FrogtownMark() {
  return (
    <div className="flex select-none items-center gap-2.5">
      <div className="relative flex size-9 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] shadow-[3px_3px_0_hsl(var(--accent))]">
        <span className="mono text-lg font-medium tracking-[-.2em]">≈</span>
        <span className="absolute -bottom-1 -right-1 size-2 rounded-full bg-[hsl(var(--sidebar-accent))]" />
      </div>
      <span className="text-lg font-bold tracking-[-.04em] text-[hsl(var(--sidebar-foreground))]">Frogtown</span>
    </div>
  );
}

export function Current() {
  return (
    <div className="swamp-app noise min-h-[100dvh] overflow-hidden">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1500px] flex-col lg:flex-row">
        <section className="relative flex min-h-[46dvh] flex-1 flex-col justify-between overflow-hidden bg-[hsl(var(--sidebar))] px-6 py-7 text-[hsl(var(--sidebar-foreground))] md:px-12 lg:min-h-[100dvh] lg:max-w-[51%] lg:px-16 lg:py-10">
          <div className="absolute -right-32 -top-32 size-96 rounded-full border border-[hsl(var(--secondary)/.17)]" />
          <div className="absolute -right-12 top-10 size-44 rounded-full border border-[hsl(var(--accent)/.28)]" />
          <div className="absolute bottom-[-15%] left-[-10%] size-80 rounded-full bg-[hsl(var(--primary)/.16)] blur-3xl" />
          <div className="relative z-10 flex items-center justify-between">
            <FrogtownMark />
            <span className="mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.45)]">XRPL / $HERMIT</span>
          </div>
          <div className="relative z-10 my-12 max-w-xl lg:my-0">
            <p className="mono mb-5 text-xs uppercase tracking-[.24em] text-[hsl(var(--sidebar-accent))]">$HERMIT community / XRPL</p>
            <h1 className="max-w-[680px] text-[clamp(3.4rem,8vw,7.6rem)] font-semibold leading-[.87] tracking-[-.085em]">
              Frogtown<br /><span className="text-[hsl(var(--sidebar-accent))]">brings us closer.</span>
            </h1>
            <p className="mt-8 max-w-md text-base leading-7 text-[hsl(var(--sidebar-foreground)/.62)] md:text-lg">
              Meet the home for $HERMIT, the chill frog of the XRPL. Connect your Xaman wallet to join encrypted chats, community rooms, and a shared timeline—bringing the people behind the ledger together.
            </p>
          </div>
          <div className="relative z-10 flex items-end justify-between gap-8">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.38)]">built for the XRPL community</p>
              <div className="mt-3 flex items-center gap-2 text-sm text-[hsl(var(--sidebar-foreground)/.68)]"><span className="size-2 rounded-full bg-[hsl(var(--sidebar-accent))]" /> One ledger. Many voices.</div>
            </div>
            <div className="mono hidden text-right text-[10px] leading-5 text-[hsl(var(--sidebar-foreground)/.38)] sm:block">your address<br />is enough.</div>
          </div>
        </section>

        <section className="wallet-grid flex flex-1 items-center justify-center px-6 py-12 md:px-12 lg:max-w-[49%]">
          <div className="w-full max-w-[460px]">
            <div className="appear">
              <div className="mb-7 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                <span className="mono rounded-full bg-[hsl(var(--primary)/.11)] px-2 py-1 text-[10px] text-[hsl(var(--primary))]">01</span>
                <span>Connect to enter</span><span className="h-px flex-1 bg-[hsl(var(--border))]" />
                <span className="mono text-[10px]">XAMAN</span>
              </div>
              <h2 className="text-4xl font-semibold leading-[.98] tracking-[-.07em] md:text-5xl">Your people<br />are in Frogtown.</h2>
              <p className="mt-5 max-w-sm leading-6 text-[hsl(var(--muted-foreground))]">Connect with Xaman to join the $HERMIT community. Your XRPL address is your identity; your private chats are encrypted on your device.</p>
            </div>
            <div className="appear appear-delay-1 mt-10 rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] p-5 shadow-[0_18px_60px_hsl(174_25%_13%/.08)]">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">W</div>
                <div><p className="font-semibold">Connect your XRPL wallet</p><p className="mt-1 text-sm leading-5 text-[hsl(var(--muted-foreground))]">Sign in securely with Xaman and make your address your Frogtown identity.</p></div>
              </div>
              <button className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] px-4 py-3.5 text-sm font-medium text-[hsl(var(--card))]">
                Connect with Xaman <span className="ml-auto">→</span>
              </button>
              <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">Encrypted conversations · XRPL mainnet</div>
            </div>
            <div className="appear appear-delay-2 mt-7 grid grid-cols-3 gap-3 text-center">
              <div><p className="text-lg font-semibold">01</p><p className="mono mt-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">wallet</p></div>
              <div><p className="text-lg font-semibold">0</p><p className="mono mt-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">profiles</p></div>
              <div><p className="text-lg font-semibold">∞</p><p className="mono mt-1 text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">signal</p></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
