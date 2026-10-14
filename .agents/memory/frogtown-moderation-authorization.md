---
name: Frogtown moderation authorization
description: Durable guardrails for moderator access and report handling in the open XRPL community.
---

Frogtown admits any connected XRPL wallet; wallet membership alone must never grant moderator privileges. Moderator actions are authorized server-side against the operator-managed `FROGTOWN_MODERATOR_WALLETS` allowlist, and an unset allowlist must fail closed. Hiding moderation controls in the client is only presentation, never authorization.

**Why:** public wallet access makes client-asserted roles or a public key directory unsuitable as an authority source.

**How to apply:** check the authenticated wallet against the server allowlist on every moderation endpoint, configure the production reviewer wallets through secret storage before inviting users, and keep test moderator overrides isolated to tests. Report rows are consumed on resolution; the separate moderator-action history retains the decision and content snapshot.

Never store moderator wallet lists in tracked configuration such as `.replit`. A list previously committed may remain visible in Git history even after removing it from the current branch; do not rewrite shared history without explicit approval.

**Why:** Moderation privileges must remain operator-controlled, while the audit table preserves decisions after the open report queue is cleared. Tracked configuration is copied to public GitHub when the repository is public.

**How to apply:** Use Replit Secrets and Vercel environment variables for the allowlist. When a value was committed, remove it from the active tree immediately, then disclose that older commits remain; ask before history rewriting.
