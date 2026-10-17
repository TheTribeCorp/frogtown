CREATE TABLE IF NOT EXISTS swamp_wallet_profiles (
  wallet_address text PRIMARY KEY,
  username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swamp_wallet_profiles_username_format_check
    CHECK (username ~ '^[a-z0-9_]{4,17}$'),
  CONSTRAINT swamp_wallet_profiles_username_unique UNIQUE (username)
);
