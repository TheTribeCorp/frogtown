---
name: Frogtown API origin policy
description: Same-origin browser API access and requirements for any future cross-origin client.
---

Keep browser API calls same-origin. Do not restore reflected credentialed CORS; if an external web or mobile client is added, require an explicit, reviewed origin allowlist and test its preflight behavior.

**Why:** The Frogtown web client uses relative `/api` routes, so arbitrary credentialed origins are unnecessary and broaden the session-cookie attack surface.

**How to apply:** Revisit this only when a separate trusted client is introduced; configure its exact origins rather than reflecting request origins.
