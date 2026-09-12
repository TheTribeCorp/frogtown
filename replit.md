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
- `lib/db/src/schema/swamp.ts` — Drizzle schema for conversations, messages, and groups

## Architecture decisions

- Xaman sign-in is the identity layer; there is no separate profile or password account.
- Direct and group chat membership is keyed by XRPL wallet address.
- Message bodies and conversation previews are encrypted at rest with `SESSION_SECRET`; the API decrypts them only when serving an authorized conversation.
- The frontend uses generated OpenAPI hooks so chat and wallet polling stay aligned with the server contract.

## Product

Users connect Xaman, use their XRPL address as their username, message any ledger address directly, and discover, create, and join encrypted group rooms. The app supports QR/deep-link wallet sessions, message persistence, polling, mobile navigation, settings, and connection health feedback.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep Xaman credentials in Replit Secrets as `XAMAN_API_KEY` and `XAMAN_API_SECRET`; never expose them in the browser.
- Re-run API codegen after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
