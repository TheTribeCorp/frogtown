---
name: Native mobile security
description: Product direction and security boundaries for Frogtown's native iOS/Android companion.
---

Keep the website while adding native iOS and Android apps.

**Why:** The user selected native apps alongside the existing website, not a replacement or WebView-only release.

**How to apply:** Preserve existing web flows when building native features.

The mobile app should include the website's features, not only chats and groups; Timeline and Daily Quests must be available to mobile members.

**Why:** The user explicitly requested the website's properties on mobile after finding only chat and group options.

**How to apply:** Check both native and web member experiences when adding product features; do not treat a chat-only mobile companion as feature-complete.

Do not treat successful server-side manifest and bundle downloads as proof that Expo Go can launch on a physical device.

**Why:** Native remote-update downloads can still fail before application code runs despite healthy HTTPS endpoints. Switching link schemes alone did not establish a working native connection.

**How to apply:** Check for an actual Android/iOS bundle request and use Replit's managed phone-preview flow to inspect device access and sign-in. Do not change wallet authentication code to address a pre-launch download error or claim a transport fix without device evidence.

Use the existing system-browser wallet verification with explicit app approval and a private PKCE verifier. Keep native bearer sessions audience-separated from browser cookies. Keep native private keys in OS secure storage, never ordinary app storage or a server. Recovery files must remain interoperable with the website.

**Why:** Reusing verified Xaman/LadyChain authentication avoids divergent wallet checks; PKCE prevents a captured request or return URL from becoming an authenticated session. Sharing authentication must not mean sharing browser private-key storage.

**How to apply:** Review session, key and cache isolation whenever adding a mobile account or device flow. Browser-preview storage is ephemeral and does not prove Keychain/Keystore behavior.

Do not call native push production-ready until an installed build has the correct Expo project, APNs/FCM credentials, and physical-device delivery checks.

**Why:** A browser preview and Expo Go cannot validate closed-app OS delivery; push-service acceptance is not a delivery receipt.

**How to apply:** Separate code/bundle verification from credentialed iPhone/Android verification in release reports.

Keep the homepage's Android and iOS download buttons marked Coming soon until real installable Frogtown builds or verified store links are available. Do not use Expo Go or JavaScript bundle exports as public app-download links.

**Why:** The user chose to keep both buttons Coming soon until standalone builds exist.

**How to apply:** Activate a platform's download button only after its install link has been tested on a real device.

Direct Android APK distribution is required while Play Store listing is deferred.

**Why:** The user chose a remote signed APK build and a website download link rather than waiting for a Play Store listing.

**How to apply:** Preserve the signing identity across updates, keep signing credentials out of the public repository, and distinguish build/signature checks from physical-phone verification. A permanent identity has been provisioned in GitHub Actions secrets; do not regenerate it when troubleshooting builds, because replacing it prevents in-place APK upgrades.

Keep shared React typings on one Expo-compatible resolution.

**Why:** Expo's narrower React typing range and the web's broader range can resolve different nominal ref types after a package install, breaking otherwise valid web UI types.

**How to apply:** Preserve the shared typing override during dependency updates unless upgrading all consumers together.
