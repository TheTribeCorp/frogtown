---
name: Frogtown timeline privacy and read state
description: $HERMIT brand positioning and the privacy boundary between the shared timeline and encrypted messages.
---

Frogtown is the wallet-connected home for $HERMIT, the chill frog of the XRPL. Keep the product copy about bringing the XRPL community together; do not imply timeline posts are stored on-ledger.

Frogtown has two distinct content classes:

- Timeline posts and comments are public to signed-in wallets and are plain text. Their author is derived from the authenticated wallet session; do not describe them as end-to-end encrypted.
- Direct and group chat content remains encrypted on the client. Read receipts are message metadata and must not expose or decrypt message bodies on the server.
- Read progress belongs to each conversation-member wallet and advances only through a message the server has verified belongs to that conversation. Pre-existing memberships with no read position start unread.

**Why:** The user asked for a public, Twitter-like timeline alongside private chats and for existing chats to appear unread after signing in. Sharing the privacy model or using a conversation-wide read flag would violate one of those expectations.

**How to apply:** Keep timeline copy, API behavior, and future media features explicitly separate from E2EE chat. Preserve per-wallet, forward-only read positions and verify conversation membership server-side before updating them.
