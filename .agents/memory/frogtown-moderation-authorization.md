---
name: Frogtown moderation authorization
description: Durable guardrails for moderator access and report handling in the open XRPL community.
---

Frogtown admits any connected XRPL wallet; wallet membership alone must never grant moderator privileges. Moderator actions are authorized server-side against the operator-managed `FROGTOWN_MODERATOR_WALLETS` allowlist, and an unset allowlist must fail closed. Hiding moderation controls in the client is only presentation, never authorization.

**Why:** public wallet access makes client-asserted roles or a public key directory unsuitable as an authority source.

**How to apply:** check the authenticated wallet against the server allowlist on every moderation endpoint, configure the production reviewer wallets before inviting users, and keep test moderator overrides isolated to tests. Dismissal currently deletes report rows; retaining an audit history requires a persistent schema change.
