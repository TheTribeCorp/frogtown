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

Use the Frogtown Expo preview on a physical Android phone for internal functional
testing. This tests Android-compatible UI and encrypted chat, but it is Expo Go,
not an installed Frogtown app: remote notifications and cold-start wallet return
must be tested in an installed native build. Replit's mobile publishing flow
does not currently produce an Android store/internal-track release. Do not
represent Expo Go as a completed Android push test.

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
