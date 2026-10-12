import { useState } from 'react';
import './_group.css';
import './Playful.css';

const conversations = [
  { side: 'received', name: 'Mara', text: 'Found a tiny XRPL art room that feels like a porch.' },
  { side: 'sent', name: 'You', text: 'That is exactly the kind of corner I came here for.' },
  { side: 'received', name: 'Mara', text: 'I’ll save you a seat. No token check, just bring your wallet.' },
];

function Mark() {
  return (
    <a className="playful-mark" href="#top" aria-label="Frogtown home">
      <span className="playful-mark-icon" aria-hidden="true">F</span>
      <span>frogtown<span className="playful-mark-period">.</span></span>
    </a>
  );
}

export function Playful() {
  const [notice, setNotice] = useState(false);

  return (
    <main className="playful-home" id="top">
      <div className="playful-shell">
        <section className="playful-stage" aria-label="Welcome to Frogtown">
          <header className="playful-header">
            <Mark />
            <div className="playful-network"><span className="playful-live-dot" /> XRPL COMMUNITY</div>
          </header>

          <div className="playful-hero-copy">
            <div className="playful-kicker"><span className="playful-kicker-line" /> A home for $HERMIT & friends</div>
            <h1>Good people.<br /><em>Good signals.</em></h1>
            <p className="playful-lede">A little more human side of the ledger. Pull up a chair, find your people, and make yourself at home.</p>
            <div className="playful-community-tags" aria-label="Frogtown spaces">
              <span>Private chats</span><span>Community rooms</span><span>Public timeline</span>
            </div>
          </div>

          <div className="playful-art" aria-label="The $HERMIT frog mascot and a sample private conversation">
            <div className="playful-art-orbit playful-orbit-one" />
            <div className="playful-art-orbit playful-orbit-two" />
            <div className="playful-mascot-wrap">
              <div className="playful-mascot-halo" />
              <img className="playful-mascot" src="/__mockup/images/hermit-mascot.jpg" alt="$HERMIT frog mascot in a red hood" />
              <span className="playful-sticker">one ledger<br />many voices</span>
            </div>
            <div className="playful-float-bubble playful-float-bubble-top"><span className="bubble-dot" />Room for your kind of weird.</div>
            <div className="playful-float-bubble playful-float-bubble-bottom">Your wallet is your hello <span className="bubble-arrow">↗</span></div>
            <div className="playful-chat-card">
              <div className="playful-chat-head">
                <div className="playful-chat-avatar">M</div>
                <div className="playful-chat-person"><strong>Mara</strong><span>private conversation</span></div>
                <span className="playful-lock" aria-label="End-to-end encrypted">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.3" y="8.5" width="11.4" height="8.2" rx="2" /><path d="M6.7 8.4V6.2a3.3 3.3 0 0 1 6.6 0v2.2" /></svg>
                </span>
              </div>
              <div className="playful-chat-messages">
                {conversations.map((message) => (
                  <div className={`playful-message ${message.side}`} key={message.name + message.text}>
                    <span>{message.text}</span>
                  </div>
                ))}
              </div>
              <div className="playful-chat-foot"><span className="playful-encryption-dot" /> End-to-end encrypted</div>
            </div>
          </div>

          <footer className="playful-stage-foot">
            <span>Made for the XRPL, open to every wallet.</span>
            <span className="playful-foot-flower" aria-hidden="true">*</span>
          </footer>
        </section>

        <section className="playful-entry" aria-labelledby="entry-title">
          <div className="playful-entry-top">
            <span className="playful-entry-index">YOUR FRONT DOOR</span>
            <a className="playful-help-link" href="#how-it-works">How it works <span aria-hidden="true">↗</span></a>
          </div>

          <div className="playful-entry-body">
            <div className="playful-welcome-badge"><span /> Welcome in</div>
            <h2 id="entry-title">Your people<br />are <span>around here.</span></h2>
            <p className="playful-entry-copy">Connect any XRPL wallet to step inside. No $HERMIT required — just a wallet address to make Frogtown yours.</p>

            <div className="playful-connect-card">
              <div className="playful-connect-top">
                <div className="playful-wallet-symbol" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4.5 6.5h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h11" /><path d="M15.5 12h4m-4 .1h.01" /></svg>
                </div>
                <div>
                  <strong>Connect with Xaman</strong>
                  <span>Secure wallet sign-in, then you’re in.</span>
                </div>
              </div>
              <button className="playful-connect-button" onClick={() => setNotice(true)} type="button">
                <span>Connect your wallet</span>
                <span className="playful-button-arrow" aria-hidden="true">↗</span>
              </button>
              {notice && <p className="playful-demo-notice" role="status">Wallet sign-in begins with Xaman in the live Frogtown app.</p>}
              <div className="playful-connect-note"><span className="playful-note-icon">i</span> Any connected XRPL wallet can enter</div>
            </div>

            <div className="playful-trust-row">
              <div className="playful-trust-icon lock-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20"><rect x="4" y="8" width="12" height="9" rx="2" /><path d="M6.5 8V6a3.5 3.5 0 0 1 7 0v2" /></svg>
              </div>
              <div><strong>Private means private.</strong><span>One-to-one chats are end-to-end encrypted.</span></div>
            </div>
            <div className="playful-trust-row timeline-row">
              <div className="playful-trust-icon timeline-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20"><path d="M5 4.5h10M5 10h10M5 15.5h6" /><circle cx="3" cy="4.5" r=".7" /><circle cx="3" cy="10" r=".7" /><circle cx="3" cy="15.5" r=".7" /></svg>
              </div>
              <div><strong>Out in the open.</strong><span>The community timeline is public to members.</span></div>
            </div>
          </div>

          <div className="playful-entry-bottom" id="how-it-works">
            <span>XRPL address = your identity</span>
            <span className="playful-entry-bottom-mark">FROGTOWN <b>·</b> XRPL</span>
          </div>
        </section>
      </div>
    </main>
  );
}
