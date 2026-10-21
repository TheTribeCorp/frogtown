---
name: Frogtown API origin policy
description: Same-origin browser API access and requirements for any future cross-origin client.
---

Keep browser API calls same-origin and do not restore reflected credentialed CORS. In the Expo web preview, use the current preview origin for `/api` requests but keep wallet approval pointed at Frogtown’s main web origin. Native clients use an explicit API origin and audience-separated bearer sessions, not browser cookies.

**Why:** Replit’s Expo web preview and the main Frogtown web app can have different hosts. Mixing the API host with the page host causes browser fetch failures or sends wallet approval to the wrong app. Arbitrary credentialed origins also broaden the session-cookie attack surface.

**How to apply:** Keep browser API calls relative/same-origin; if a cross-origin preview is unavoidable, allow only its exact configured development origin and never cookies. Build the native wallet-approval URL from Frogtown’s web origin, while native API calls use the explicit API origin and bearer token.
