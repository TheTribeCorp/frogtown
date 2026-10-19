CREATE TABLE IF NOT EXISTS swamp_wallet_auth_challenges (
  nonce_hash text PRIMARY KEY,
  wallet_address text NOT NULL,
  origin text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swamp_wallet_auth_challenges_expires_idx
  ON swamp_wallet_auth_challenges (expires_at);
