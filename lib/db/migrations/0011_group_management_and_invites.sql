CREATE TABLE IF NOT EXISTS "swamp_group_invites" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "created_by_address" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "swamp_group_invites_group_active_idx"
  ON "swamp_group_invites" USING btree ("group_id", "revoked_at");
