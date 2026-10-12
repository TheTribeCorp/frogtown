---
name: SWAMP encryption model
description: Security constraints and user-facing limitations of SWAMP's recipient-only message encryption.
---

SWAMP wallet authentication does not provide an encryption key. Keep message secrets client-side, never restore server-side message decryption, and do not silently replace a registered public key because old messages depend on the matching local private key. The server's public-key directory can be substituted by a malicious server; users need to compare the conversation safety code through a separate trusted channel. Device recovery is not available, so loss of local browser data means loss of access to encrypted history. This custom protocol has not received an independent security audit.

**Why:** A wallet address proves the logged-in identity but cannot derive a shared encryption secret without exposing the wallet's signing key; an unauthenticated public-key directory creates a key-substitution risk.

**How to apply:** Preserve the client-only trust boundary in future messaging changes, keep recovery and key-verification warnings visible, and review protocol changes before claiming production-grade secure messaging.
