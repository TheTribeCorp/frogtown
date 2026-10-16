CREATE TABLE IF NOT EXISTS "swamp_push_subscriptions" (
  "endpoint" text PRIMARY KEY,
  "wallet_address" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "swamp_push_subscriptions_wallet_idx"
  ON "swamp_push_subscriptions" USING btree ("wallet_address");
