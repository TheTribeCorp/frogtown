CREATE TABLE IF NOT EXISTS "swamp_message_history_shares" (
  "conversation_id" text NOT NULL,
  "message_id" text NOT NULL,
  "recipient_address" text NOT NULL,
  "shared_by_address" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "swamp_message_history_shares_pk"
    PRIMARY KEY ("conversation_id", "message_id", "recipient_address")
);

CREATE INDEX IF NOT EXISTS "swamp_message_history_shares_recipient_idx"
  ON "swamp_message_history_shares" USING btree ("conversation_id", "recipient_address");
