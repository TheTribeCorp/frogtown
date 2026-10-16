ALTER TABLE "swamp_conversations"
  ADD COLUMN IF NOT EXISTS "direct_status" text NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS "requester_address" text;

CREATE TABLE IF NOT EXISTS "swamp_blocked_wallets" (
  "wallet_address" text NOT NULL,
  "blocked_wallet_address" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "swamp_blocked_wallets_pk"
    PRIMARY KEY ("wallet_address", "blocked_wallet_address")
);

CREATE INDEX IF NOT EXISTS "swamp_blocked_wallets_blocked_idx"
  ON "swamp_blocked_wallets" USING btree ("blocked_wallet_address");
