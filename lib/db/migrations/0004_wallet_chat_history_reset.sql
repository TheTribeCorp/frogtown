ALTER TABLE "swamp_conversation_members"
  ADD COLUMN IF NOT EXISTS "history_starts_at" timestamp with time zone;
