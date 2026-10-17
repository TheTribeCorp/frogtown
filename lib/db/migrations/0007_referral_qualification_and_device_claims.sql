ALTER TABLE frogtown_referrals
  ADD COLUMN IF NOT EXISTS rewarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS qualified_day_key text;

-- Existing referral records were already paid under the previous rules.
UPDATE frogtown_referrals
SET rewarded_at = created_at
WHERE rewarded_at IS NULL;

CREATE TABLE IF NOT EXISTS frogtown_referral_device_claims (
  device_id_hash text PRIMARY KEY,
  wallet_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frogtown_referral_device_claims_wallet_idx
  ON frogtown_referral_device_claims (wallet_address);
