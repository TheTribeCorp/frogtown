# Frogtown launch-readiness checklist

**Status:** Not cleared for broad public launch yet. The core web/API build is healthy, but several safety, policy, and real-user verification gates remain open.  
**Last reviewed:** 2026-10-12

`[x]` means implemented and checked in the development environment. `[ ]` means it still needs work, owner input, or production verification.

## P0 — public-launch gates

- [x] **Wallet access and session protection:** Any connected XRPL wallet can enter; session cookies are HTTP-only and `SameSite=Lax`.
- [x] **Same-origin API boundary:** The web app uses `/api`; API responses no longer grant credentialed access to arbitrary origins. A cross-origin regression assertion is included.
- [x] **Private-chat authorization:** Conversation membership is required to fetch messages or encryption keys, send messages, and advance read state. Regression tests cover unauthenticated, mismatched-wallet, and non-member requests.
- [x] **Unread state and receipts:** Existing conversation history remains unread until read progress advances; read receipts are shown with double ticks.
- [x] **Delivery recovery path:** Sends are idempotent and persisted; SSE is a notification hint, with reconnect/online refresh and persisted-history polling as recovery.
- [x] **Timeline basics:** Signed-in wallets can post, like, comment, load older posts/replies, and report posts or comments. Timeline content is public plain text, separate from encrypted chats.
- [x] **New-device key recovery:** Users can create and restore passphrase-encrypted backups. The restore path checks the wallet and registered encryption key before saving.
- [x] **Automated security checks:** Dependency audit, SAST, and privacy/dataflow scans returned zero findings after dependency updates and CORS hardening.
- [x] **Build and regression checks:** API/web/mockup-sandbox typechecks pass; web production build passes; all 3 API authorization tests pass; OpenAPI code generation and library typecheck pass.
- [x] **Development schema:** The timeline-report schema is applied to the development database.
- [ ] **Independent cryptography review:** The custom E2EE protocol and public-key verification/safety-code flow have not been independently audited.
- [ ] **Moderation operations:** Reports can be submitted and stored, but moderators do not yet have a review, resolution, or action queue. A follow-up is queued.
- [ ] **User content controls:** Authors cannot yet edit or remove their own timeline posts/comments. A follow-up is queued.
- [ ] **Abuse protection:** Add and test effective rate limits and spam controls for sign-in and public write endpoints; ensure IP handling trusts only the actual proxy chain.
- [ ] **Owner-approved policies:** Publish accurate privacy terms, community rules, support/contact details, and data-retention/deletion procedures. These need product-owner input and should not be inferred from code.
- [ ] **Real-wallet end-to-end review:** Verify Xaman sign-in/return routing, private and group chats, key recovery, receipts, timeline, and report flows on desktop and mobile with real test wallets. The preview screenshot only covered the signed-out page.
- [ ] **Production readiness:** Apply the reviewed schema through the production publishing flow, verify backups/restore and monitoring, then run a production smoke test. No production migration or deployment has been performed.

## Known limitations to disclose

- Keys created before encrypted backup support are non-exportable. Without a prior backup, those chats remain accessible only from the original browser that still has the key.
- Timeline posts and comments are public plain text; they are not on-ledger and are not end-to-end encrypted.
- A clean automated scan does not replace an independent security review, especially for custom cryptography.

## P1 — improve parity after launch gates

- [ ] Assess push notifications, typing/presence, chat and timeline search, richer profiles, and media attachments against the community's needs.
- [ ] Exercise delivery and read receipts under multi-tab, offline/online, and multi-instance conditions.
- [ ] Add ongoing production monitoring and a documented incident-response process.
