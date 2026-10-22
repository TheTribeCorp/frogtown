# Frogtown native build setup

The website remains a separate app. Mobile wallet login opens the same Frogtown
website in the system browser, asks the member to approve the requesting app, and
redeems the approval using a private S256 PKCE verifier. Tokens never appear in
redirect URLs. Session tokens and encryption identities use Keychain/Keystore;
the web preview only keeps them in memory.

## Test-build readiness

The database migration and Frogtown API deployment are complete. The static app
configuration now targets the verified production API for release builds while
the Replit development preview continues using its development API. The iOS
bundle ID and Android package name are set; keep them stable.

### iOS TestFlight

1. Use Replit's **Expo Launch** guided flow to produce the iOS build and submit
   it to TestFlight. A paid Apple Developer Program membership is required for
   App Store Connect distribution.
2. Complete any signing, app listing, and push-notification credential steps
   requested by Launch. Push cannot be proven by a browser or Expo Go session.
3. If Launch provides a public Expo push project ID, place it in the static
   `extra.eas.projectId` field in `app.json` before making the TestFlight build.
   This ID is public; never place private signing or push credentials in app
   source or `EXPO_PUBLIC_*` variables.
4. Install the TestFlight build on a physical iPhone and test:
   - Browser wallet approval using Xaman and a LadyChain wallet, return to app,
     cancellation, expiry, process termination, and a fresh launch.
   - Restore a web recovery file; read web-sent messages; send native-sent messages
     back to the web; create and restore a native recovery file.
   - Private requests, group join, key-not-ready delivery warning, history sharing,
     outbox retry after process termination, and double-tick read receipts.
   - Enable alerts, close the app, receive a message, open it by notification,
     revoke the phone from another device, and verify delivery stops.

### Android

The Android APK is built on GitHub Actions and published as a GitHub Release.
The website's Android download button stays disabled until a signed release
has been installed and checked on a real Android phone.

#### One-time signing setup

The upload key is permanent: losing or replacing it prevents existing APK users
from installing future updates over their current app. Keep a secure backup and
never commit the key or its password.

1. On a trusted computer with JDK 17 or later, generate a key:

   ```sh
   keytool -genkeypair -v -keystore frogtown-upload.jks -storetype JKS \
     -alias frogtown-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   Save the keystore password, key password, and alias in a password manager.
2. Base64-encode `frogtown-upload.jks` without line breaks. On macOS/Linux:

   ```sh
   base64 < frogtown-upload.jks | tr -d '\n'
   ```

   On PowerShell:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("frogtown-upload.jks"))
   ```
3. In the GitHub repository, open **Settings → Secrets and variables → Actions**
   and create these repository secrets:

   - `ANDROID_RELEASE_KEYSTORE_BASE64` — the base64 output
   - `ANDROID_RELEASE_STORE_PASSWORD` — the keystore password
   - `ANDROID_RELEASE_KEY_ALIAS` — `frogtown-upload` (or the alias chosen)
   - `ANDROID_RELEASE_KEY_PASSWORD` — the key password

   Never paste these values into a chat, issue, commit, or workflow log.
 4. Sync the project changes to GitHub. In **Actions → Frogtown Android APK**,
   choose **Run workflow** and use the version tag matching `app.json`, such as
   `android-v1.0.2`.
 5. After the workflow succeeds, check the release for the arm64-v8a APK, the
   armeabi-v7a APK, the universal fallback, and `Frogtown-android-sha256.txt`.
   The stable direct-download URL for the universal APK is:
   `https://github.com/TheTribeCorp/frogtown/releases/latest/download/Frogtown.apk`
6. Install the APK on a physical Android phone. Android will ask the user to
   allow installation from the browser. Test wallet return, private/group
   encrypted message send and receive, app restart/outbox recovery, and alerts.
   APK signing verification alone does not verify these device behaviors.
7. Only after the installed-phone checks pass, set the public Vercel build
   variable `VITE_ANDROID_APK_URL` to that stable download URL and redeploy the
   website. This activates the homepage button without exposing a dead link
   before the first build exists.

Increment `android.versionCode` in `app.json` for every subsequent APK release.
Keep the package ID and signing key unchanged. The APK is stored as a GitHub
Release asset rather than in Git history or Vercel's static deployment.

The release workflow publishes signature-verified arm64-v8a and armeabi-v7a
APK downloads plus the universal `Frogtown.apk` fallback. The mobile inbox
checks GitHub's latest public Android release periodically and offers the
compatible smaller package, its download size, and the universal fallback.

The public Android application ID remains `online.frogtown.app`.

Native alerts use Expo's push relay to APNs/FCM. Payloads contain generic copy and
opaque conversation/message IDs, never wallet addresses or message plaintext.
Push service acceptance is not a guarantee of OS delivery. The app always loads
the persisted message history on resume.

## Test commands

From the workspace root:

```
pnpm run typecheck
pnpm --filter @workspace/scripts exec tsx --test ../artifacts/frogtown-mobile/test/crypto.test.mjs
pnpm --filter @workspace/api-server run test:auth
```

The browser preview cannot verify OS secure storage, wallet-app return behavior,
or APNs/FCM delivery. Those checks require installed builds on physical devices.
The custom E2EE protocol remains subject to the existing independent-review gap.
