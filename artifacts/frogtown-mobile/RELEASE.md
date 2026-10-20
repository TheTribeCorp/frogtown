# Frogtown native build setup

The website remains a separate app. Mobile wallet login opens the same Frogtown
website in the system browser, asks the member to approve the requesting app, and
redeems the approval using a private S256 PKCE verifier. Tokens never appear in
redirect URLs. Session tokens and encryption identities use Keychain/Keystore;
the web preview only keeps them in memory.

## Before a production native build

1. Apply `lib/db/migrations/0010_native_mobile_auth_and_push.sql` to the correct
   external production Neon database with the operator's approval. Development
   schema changes do not automatically migrate this external database.
2. Deploy the website and API changes together so `/mobile/auth/*` works on the
   configured HTTPS origin.
3. Set the public build variable `EXPO_PUBLIC_API_URL` to the verified production
   Frogtown origin. Development uses `EXPO_PUBLIC_DOMAIN` supplied by the preview.
4. Link the app to the Expo push project and set `EXPO_PUBLIC_EAS_PROJECT_ID` to
   that project's UUID before building. This is a public project identifier, not
   a secret. The app config includes it in `extra.eas.projectId`.
5. Configure APNs credentials for iOS and FCM v1 credentials for Android with the
   build/push provider. Never put private credentials in Expo public variables.
   Keep the bundle/package ID `online.frogtown.app` consistent with credentials.
6. Build an installed development/release client. Expo Go does not support this
   app's remote push enrollment. The app reports this restriction explicitly.
7. On a physical iPhone and Android phone, test:
   - Browser wallet approval using Xaman and a LadyChain wallet, return to app,
     cancellation, expiry, process termination, and a fresh launch.
   - Restore a web recovery file; read web-sent messages; send native-sent messages
     back to the web; create and restore a native recovery file.
   - Private requests, group join, key-not-ready delivery warning, history sharing,
     outbox retry after process termination, and double-tick read receipts.
   - Enable alerts, close the app, receive a message, open it by notification,
     revoke the phone from another device, and verify delivery stops.

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
