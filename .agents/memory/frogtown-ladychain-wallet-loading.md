---
name: LadyChain wallet loading
description: Performance constraints and loading behavior for Frogtown's Reown mobile wallet selector.
---

Keep the Reown AppKit runtime out of the initial page load. Begin loading it when the LadyChain connect option is in view or the member signals intent, skip speculative loading when Save-Data is enabled, and show a retry if the download fails.

**Why:** The wallet selector has a substantial first-use payload, and forcing its vendor packages into manual chunks created circular dependencies and duplicated bundles instead of improving performance.

**How to apply:** Preserve lazy loading and intent-based preloading. When changing the wallet stack or bundling, compare production compressed size and test the real mobile wallet handoff; do not trade connection reliability for a smaller chunk without verifying the return flow.

**Validation:** The user confirmed that LadyChain sign-in returned from a mobile wallet app to Frogtown and completed successfully on a phone.
