---
name: Drizzle aggregate timestamps
description: Runtime decoding behavior for timestamps returned by raw SQL aggregates in the Frogtown API.
---

Use an explicit Drizzle `mapWith` decoder for timestamps returned from raw SQL aggregates such as `min(timestamp)` and `max(timestamp)`. A TypeScript `sql<Date>` annotation alone does not guarantee the driver returns a `Date` object.

**Why:** Calling `.toISOString()` on an aggregate result caused a moderator referral-review endpoint to fail even though normal timestamp columns were decoded as dates.

**How to apply:** When using raw aggregate SQL for timestamps, normalize the driver value to `Date` at the query boundary before formatting or comparing it.
