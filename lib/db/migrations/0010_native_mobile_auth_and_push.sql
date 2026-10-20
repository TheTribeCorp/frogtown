BEGIN;
CREATE TABLE IF NOT EXISTS frogtown_mobile_auth_requests (
  id text PRIMARY KEY,
  code_challenge text NOT NULL,
  client_hash text NOT NULL,
  wallet_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS frogtown_mobile_auth_client_idx
  ON frogtown_mobile_auth_requests (client_hash, created_at);
CREATE TABLE IF NOT EXISTS frogtown_native_push_devices (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  wallet_address text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS frogtown_native_push_wallet_idx
  ON frogtown_native_push_devices (wallet_address);
COMMIT;
