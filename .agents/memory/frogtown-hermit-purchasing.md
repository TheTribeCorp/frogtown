---
name: Frogtown $HERMIT purchases
description: The user's chosen model for token purchases and holder checks.
---

Frogtown must not execute or prepare $HERMIT buys inside the app. It should show a copyable $HERMIT contract/issuer address so members can buy on an external XRPL platform. On every wallet login, bypass the short balance cache and scan the signed-in wallet's $HERMIT trustline, showing the verified amount and the existing holder star.

**Why:** the user asked to move buys off-app and check each member's holdings and amount at every login.

**How to apply:** keep the public contract address copyable, disable in-app trading endpoints, and use the authenticated wallet balance check with a forced refresh at login.
