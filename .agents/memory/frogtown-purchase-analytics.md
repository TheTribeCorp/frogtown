---
name: Frogtown purchase analytics
description: Privacy limits for analytics on the in-app $HERMIT purchase flow.
---

Purchase-flow analytics must accept only fixed event labels and expose daily aggregate counts. Do not persist or send wallet addresses, transaction identifiers/details, or free-form content in analytics.

**Why:** the user explicitly required progress visibility without tying events to member identities or transactions.

**How to apply:** instrument purchase steps with a fixed enum and aggregate storage; restrict detailed analytics to moderators and do not add per-member funnel histories.
