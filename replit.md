# SWAMP

SWAMP is a wallet-native XRPL chat platform where Xaman-connected wallet addresses are the user's identity for direct and group conversations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/swamp-chat` — responsive React/Vite web app and chat workspace
- `artifacts/api-server/src/routes/swamp.ts` — Xaman sessions, conversations, messages, and groups
- `artifacts/api-server/src/lib/message-crypto.ts` — AES-256-GCM message encryption at rest
- `lib/api-spec/openapi.yaml` — source of truth for generated API clients
- `lib/db/src/schema/swamp.ts` — Drizzle schema for conversations, messages, groups, and recipient-only history shares

## Architecture decisions

- Xaman sign-in is the identity layer; there is no separate profile or password account.
- Direct and group chat membership is keyed by XRPL wallet address.
- Message bodies are encrypted end-to-end on the sender's device; the API stores ciphertext and does not decrypt it. `SESSION_SECRET` signs wallet session cookies, while Vercel Preview uses the separate `PREVIEW_SESSION_SECRET`.
- Group history is automatically re-encrypted on an existing member's device for a newcomer; the server stores only ciphertext addressed to that recipient. Apply `lib/db/migrations/0001_group_message_history_shares.sql` to external Neon databases before deploying this feature.
- Members who explicitly forget an unavailable encryption backup can reset their own chat-history visibility and encryption key while remaining in groups; other participants' messages are preserved. Reset events clear retry data and cached chats across active tabs/devices, and Frogtown prompts the member to download a new encrypted backup. Apply `lib/db/migrations/0004_wallet_chat_history_reset.sql` to external Neon databases before deploying this feature.
- The frontend uses generated OpenAPI hooks so chat and wallet polling stay aligned with the server contract.
- Background message alerts use Web Push. Keep notification payloads generic (never include message plaintext), keep the VAPID private key in deployment secrets, and preserve the VAPID key pair across deployments; rotating it requires devices to subscribe again. External Neon requires `lib/db/migrations/0003_browser_push_subscriptions.sql`.

## Product

Users connect Xaman, use their XRPL address as their username, message any ledger address directly, and discover, create, and join encrypted group rooms. The app supports QR/deep-link wallet sessions, message persistence, polling, mobile navigation, settings, and connection health feedback.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep Xaman credentials in Replit Secrets as `XAMAN_API_KEY` and `XAMAN_API_SECRET`; never expose them in the browser.
- Re-run API codegen after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
