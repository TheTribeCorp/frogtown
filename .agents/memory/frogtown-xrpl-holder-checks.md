---
name: XRPL $HERMIT holder checks
description: Clio `account_lines` peer-filter behavior and issuer-perspective balance sign
---

Query the issuer account with the wallet as `peer` when checking a $HERMIT trustline. Some Clio nodes can return an empty page for a wallet-side `account_lines` query even when the issuer has a live trustline to that wallet. The returned balance is from the issuer's perspective, so a negative balance is the holder's positive token amount.

**Why:** A wallet-side lookup returned no trustlines for known holders, while the issuer-side peer lookup returned the correct trustline and balance.

**How to apply:** For future $HERMIT verification, use issuer-side `account_lines`, verify the peer and currency, then interpret the sign before applying the holder thresholds.

Vercel's in-process lookup queues and caches are per instance, not global. Short CDN caching for successful public results reduces repeated hot-wallet requests, but cannot cap a distributed burst of unique addresses.

**Why:** Serverless instances scale independently, so local concurrency limits multiply as Vercel adds instances.

**How to apply:** Keep per-instance limits and public edge caching, but use a shared database/cache-backed rate limit before claiming global protection against arbitrary-wallet lookup floods.
