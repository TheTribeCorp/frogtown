---
name: Web context singletons
description: Why mobile dependency changes can break otherwise correctly wrapped web authentication hooks.
---

Preserve one runtime instance of React Query across the web app, shared API hooks, and wallet integrations.

**Why:** Adding native dependencies introduced separate pnpm peer variants of the same React Query version. The production website then crashed at mobile wallet approval with “No QueryClient set” even though a provider was present: hooks and provider referenced different context instances.

**How to apply:** Treat context-bearing packages as singletons in the web bundler, not merely as matching version numbers. After mobile or wallet dependency changes, verify the production browser approval entry rather than relying on TypeScript and API tests alone. Do not align native and web React versions blindly to solve a bundling issue.
