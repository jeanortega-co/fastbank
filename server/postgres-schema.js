export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  document TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  trust_score INTEGER NOT NULL DEFAULT 60,
  totp_secret TEXT,
  totp_pending_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  card_number TEXT,
  cvv TEXT,
  card_limit BIGINT NOT NULL DEFAULT 1800000,
  card_locked INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_number ON users(card_number) WHERE card_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('checking', 'pocket', 'treasury', 'loan_receivable')),
  name TEXT NOT NULL,
  goal BIGINT,
  balance BIGINT NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_checking ON accounts(user_id) WHERE kind = 'checking';
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id, kind);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL,
  counterparty_user_id TEXT REFERENCES users(id),
  account_id TEXT,
  counterparty_account_id TEXT,
  reference TEXT,
  idempotency_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference) WHERE reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  ceremony TEXT NOT NULL CHECK (ceremony IN ('registration', 'authentication')),
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'password' CHECK (purpose IN ('password', 'pin')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS email_verifications (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  registration_token_hash TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  document TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  card_type TEXT NOT NULL CHECK (card_type IN ('physical', 'digital')),
  address TEXT,
  city TEXT,
  department TEXT,
  postal_code TEXT,
  card_kind TEXT NOT NULL DEFAULT 'debit' CHECK (card_kind IN ('debit', 'credit')),
  card_number TEXT,
  cvv TEXT,
  card_status TEXT NOT NULL DEFAULT 'pending' CHECK (card_status IN ('pending', 'active', 'rejected')),
  card_limit BIGINT NOT NULL DEFAULT 0,
  card_locked INTEGER NOT NULL DEFAULT 0,
  estimated_ready_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_requests_card_number ON card_requests(card_number) WHERE card_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_requests_user ON card_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  response TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_requests_user ON support_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_date ON ledger_entries(account_id, created_at);

CREATE TABLE IF NOT EXISTS aviator_rounds (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('betting', 'flying', 'crashed')),
  server_seed_hash TEXT NOT NULL,
  server_seed TEXT,
  crash_point DOUBLE PRECISION NOT NULL,
  betting_ends_at TEXT NOT NULL,
  started_at TEXT,
  crashed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_aviator_rounds_status ON aviator_rounds(status, betting_ends_at);

CREATE TABLE IF NOT EXISTS aviator_bets (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES aviator_rounds(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  amount BIGINT NOT NULL CHECK (amount > 0),
  auto_cashout DOUBLE PRECISION,
  status TEXT NOT NULL CHECK (status IN ('active', 'cashed_out', 'lost', 'refunded')),
  cashout_multiplier DOUBLE PRECISION,
  payout BIGINT NOT NULL DEFAULT 0 CHECK (payout >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (round_id, user_id, slot),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_aviator_bets_user_date ON aviator_bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aviator_bets_round_status ON aviator_bets(round_id, status);
CREATE INDEX IF NOT EXISTS idx_aviator_bets_status ON aviator_bets(status);

CREATE TABLE IF NOT EXISTS casino_limits (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  max_bet BIGINT NOT NULL DEFAULT 500000 CHECK (max_bet > 0),
  daily_bet_limit BIGINT NOT NULL DEFAULT 2000000 CHECK (daily_bet_limit > 0),
  daily_loss_limit BIGINT NOT NULL DEFAULT 500000 CHECK (daily_loss_limit > 0),
  self_excluded_until TEXT,
  age_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  term INTEGER NOT NULL,
  rate_basis_points INTEGER NOT NULL,
  total_payable BIGINT NOT NULL,
  remaining_balance BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loans_user_status ON loans(user_id, status);

CREATE TABLE IF NOT EXISTS loan_payments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id, created_at);

CREATE TABLE IF NOT EXISTS investment_positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  symbol TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  shares_scaled BIGINT NOT NULL CHECK (shares_scaled > 0),
  purchase_price BIGINT NOT NULL CHECK (purchase_price > 0),
  term_days INTEGER NOT NULL CHECK (term_days IN (7, 30, 90, 180)),
  matures_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  payout BIGINT,
  purchase_transaction_id TEXT NOT NULL REFERENCES transactions(id),
  close_transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_investment_positions_user ON investment_positions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investment_positions_maturity ON investment_positions(status, matures_at);
`

export const SQLITE_IMPORT_TABLES = [
  'users',
  'accounts',
  'transactions',
  'audit_logs',
  'webauthn_credentials',
  'webauthn_challenges',
  'password_reset_tokens',
  'email_verifications',
  'card_requests',
  'support_requests',
  'ledger_entries',
  'aviator_rounds',
  'aviator_bets',
  'casino_limits',
  'loans',
  'loan_payments',
  'investment_positions',
]
