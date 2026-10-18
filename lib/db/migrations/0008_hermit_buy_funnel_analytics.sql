CREATE TABLE IF NOT EXISTS frogtown_hermit_buy_funnel_daily (
  event_day date NOT NULL,
  event text NOT NULL CHECK (event IN (
    'quote_preview',
    'trustline_approval',
    'buy_approval',
    'buy_completed',
    'buy_unfilled',
    'buy_failed',
    'buy_rejected',
    'buy_expired',
    'buy_wallet_mismatch',
    'trustline_rejected',
    'trustline_expired',
    'trustline_wallet_mismatch'
  )),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  PRIMARY KEY (event_day, event)
);
