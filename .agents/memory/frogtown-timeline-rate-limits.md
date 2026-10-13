---
name: Frogtown timeline rate limits
description: Cross-instance safety and timestamp handling for public timeline throttling.
---

Timeline post and comment throttles should coordinate through the database inside the same transaction as the write. A process-local counter is not reliable once the API runs on multiple Vercel instances. Return an HTTP 429 with a meaningful `Retry-After` value so clients can explain when to retry.

**Why:** simultaneous requests can otherwise observe the same pre-write count and all pass a per-wallet cap. The PostgreSQL driver's raw timestamp aggregate may arrive as text rather than a JavaScript `Date`, so parse or cast the aggregate explicitly before doing date arithmetic.

**How to apply:** use this approach for public timeline creation limits and concurrent-request tests; do not rely on memory-only throttles for production enforcement.
