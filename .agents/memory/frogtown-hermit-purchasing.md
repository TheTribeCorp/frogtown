---
name: Frogtown $HERMIT purchases
description: The user's chosen model for token purchases and holder checks.
---

Frogtown must not execute or prepare $HERMIT buys inside the app. The market-cap ticker should show only the market cap, with no contract-address copy control, wallet-balance readout, or purchase action. On every wallet login, bypass the short balance cache and scan the signed-in wallet's $HERMIT trustline for holder status.

**Why:** the user wants a market-cap-only ticker while keeping a fresh holder check on login.

**How to apply:** keep in-app trading routes disabled, keep the ticker visually limited to market cap, and use the authenticated wallet balance check with a forced refresh at login.
