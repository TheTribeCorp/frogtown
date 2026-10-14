---
name: SWAMP encryption model
description: Security constraints and user-facing limitations of SWAMP's recipient-only message encryption.
---

SWAMP wallet authentication does not provide an encryption key. Keep message secrets client-side, never restore server-side message decryption, and do not silently replace a registered public key because old messages depend on the matching local private key. Before persisting a message, validate its envelope on the server and require its recipient-wallet set to exactly match current conversation membership; client-side recipient selection alone is not authoritative. Device recovery uses a passphrase-encrypted file; verify the wallet and existing public key before restoring, and never send the passphrase or private key to the server. Keys created before encrypted backup support are non-exportable, so losing their original browser data without an existing backup means losing access to that history. The server's public-key directory can be substituted by a malicious server; users need to compare the conversation safety code through a separate trusted channel. This custom protocol has not received an independent security audit.

**Why:** A wallet address proves the logged-in identity but cannot derive a shared encryption secret without exposing the wallet's signing key; an unauthenticated public-key directory creates a key-substitution risk. A group sender could also include a non-member's public key in a ciphertext envelope; that wallet could later join and retrieve older ciphertext unless the server checks envelope recipients against membership at send time.

**How to apply:** Preserve the client-only trust boundary in future messaging changes, validate each send's recipient set against server-side conversation membership, keep recovery and key-verification warnings visible, never overwrite a mismatched local key silently, and review protocol changes before claiming production-grade secure messaging.
