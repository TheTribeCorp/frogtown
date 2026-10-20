---
name: Frogtown API origin policy
description: Same-origin browser API access and requirements for any future cross-origin client.
---

Keep production browser API calls same-origin. Do not restore reflected credentialed CORS. Native clients use audience-separated bearer sessions, not cross-origin browser cookies. The Expo browser development preview may use only its exact configured workspace origin without credentialed CORS.

**Why:** The Frogtown web client uses relative `/api` routes, so arbitrary credentialed origins are unnecessary and broaden the session-cookie attack surface. Native networking does not require browser CORS; only the separate development browser preview does.

**How to apply:** Configure exact trusted origins rather than reflecting origins. Keep browser wallet approval cookie-authenticated and same-origin, even when the requesting client is native.
