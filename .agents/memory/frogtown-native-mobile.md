---
name: Native mobile security
description: Product direction and security boundaries for Frogtown's native iOS/Android companion.
---

Keep the website while adding native iOS and Android apps.

**Why:** The user selected native apps alongside the existing website, not a replacement or WebView-only release.

**How to apply:** Preserve existing web flows when building native features.

Use `exps://` for Expo Go links through the HTTPS-only Replit Expo preview host; do not assume the CLI's printed `exp://` link is reachable.

**Why:** The preview host served the Android manifest and bundle over HTTPS while its HTTP port was unreachable. An insecure Expo link can fail before the Android bundle reaches Metro, even when the browser preview works.

**How to apply:** Obtain the current preview host rather than remembering a URL. Check manifest and launch-asset availability over HTTPS and provide the secure Expo scheme; do not confuse browser-preview success with a native-device test.

Use the existing system-browser wallet verification with explicit app approval and a private PKCE verifier. Keep native bearer sessions audience-separated from browser cookies. Keep native private keys in OS secure storage, never ordinary app storage or a server. Recovery files must remain interoperable with the website.

**Why:** Reusing verified Xaman/LadyChain authentication avoids divergent wallet checks; PKCE prevents a captured request or return URL from becoming an authenticated session. Sharing authentication must not mean sharing browser private-key storage.

**How to apply:** Review session, key and cache isolation whenever adding a mobile account or device flow. Browser-preview storage is ephemeral and does not prove Keychain/Keystore behavior.

Do not call native push production-ready until an installed build has the correct Expo project, APNs/FCM credentials, and physical-device delivery checks.

**Why:** A browser preview and Expo Go cannot validate closed-app OS delivery; push-service acceptance is not a delivery receipt.

**How to apply:** Separate code/bundle verification from credentialed iPhone/Android verification in release reports.

Keep shared React typings on one Expo-compatible resolution.

**Why:** Expo's narrower React typing range and the web's broader range can resolve different nominal ref types after a package install, breaking otherwise valid web UI types.

**How to apply:** Preserve the shared typing override during dependency updates unless upgrading all consumers together.
