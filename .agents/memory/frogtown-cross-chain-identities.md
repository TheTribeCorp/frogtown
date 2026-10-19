---
name: Frogtown cross-chain identities
description: Identity and token-check rules for adding EVM wallets alongside XRPL wallets.
---

Frogtown accepts XRPL wallets through Xaman and EVM wallets on LadyChain as separate, first-class identities for usernames, chat, groups, timeline, and quests. Normalize EVM addresses to lowercase before storing or looking them up. $HERMIT holder checks and verification stars are XRPL-only; do not send EVM addresses to XRPL lookup services.

**Why:** The user wants both XRPL and LadyChain communities to use Frogtown, while the $HERMIT asset and its holder verification are on XRPL. The user also wants EVM account changes to update the signed-in Frogtown identity.

**How to apply:** Keep session identity validation and address-based API schemas dual-chain. Add new EVM chains through signed, one-time login challenges; do not treat an EVM address as an XRPL address or infer a bridged $HERMIT balance. On account changes, require a fresh signature, update the shared wallet session, and clear wallet-scoped caches across tabs before showing the new identity's data.
