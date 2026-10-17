CREATE TABLE IF NOT EXISTS frogtown_referrals (
  id text PRIMARY KEY,
  referrer_wallet_address text NOT NULL,
  referred_wallet_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frogtown_referrals_referred_wallet_unique UNIQUE (referred_wallet_address),
  CONSTRAINT frogtown_referrals_no_self_referral_check
    CHECK (referrer_wallet_address <> referred_wallet_address)
);

CREATE INDEX IF NOT EXISTS frogtown_referrals_referrer_created_idx
  ON frogtown_referrals (referrer_wallet_address, created_at);
