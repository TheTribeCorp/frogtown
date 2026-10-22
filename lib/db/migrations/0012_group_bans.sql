CREATE TABLE IF NOT EXISTS "swamp_group_bans" (
  "group_id" text NOT NULL,
  "wallet_address" text NOT NULL,
  "removed_by_address" text NOT NULL,
  "removed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "swamp_group_bans_pk" PRIMARY KEY ("group_id", "wallet_address")
);

CREATE INDEX IF NOT EXISTS "swamp_group_bans_group_removed_idx"
  ON "swamp_group_bans" USING btree ("group_id", "removed_at");
