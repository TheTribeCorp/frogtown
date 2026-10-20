---
name: SWAMP message delivery
description: Delivery guarantees and fallback strategy for real-time SWAMP messages.
---

Persist encrypted messages first, then publish notifications containing identifiers only. PostgreSQL notifications fan out across API instances, while authenticated SSE delivers to connected members. Neither SSE nor PostgreSQL notifications are the message store: reconnect, tab focus, and periodic history fetches must recover missed notifications. Keep message sends idempotent so a retry after a lost response cannot create duplicates. When polling by timestamp and a random message ID, scan a short overlap window and deduplicate within the stream because timestamp-plus-ID is not commit order.

**Why:** Live streams and database notifications are transient; durable history is the source of truth, and a successful write can outlive a lost HTTP response. Concurrent inserts can commit late with a timestamp/ID pair behind the most recently emitted cursor.

**How to apply:** Preserve the database-first ordering, member-scoped notification delivery, reconnect recovery, and client-generated idempotency key whenever the transport or server deployment model changes. If a durable monotonic database cursor is unavailable, use an overlap window plus message-ID deduplication for polling streams.

Serverless recovery applies to security events as well as messages: a fresh-start key reset must be discoverable from durable state, not solely an in-process/PG notification. Initial key registration is not a reset.

**Why:** A Vercel stream cannot depend on a long-lived listener, and missing reset hints can leave another device displaying stale chat data.

**How to apply:** When adding or changing event types, check their persisted recovery behavior and distinguish ordinary creation from destructive identity changes.
