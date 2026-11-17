import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.DATABASE_PATH || resolve(root, 'data', 'fastbank.sqlite')
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is configured, but the application routes still require the SQLite adapter; refusing to run against an unintended database.')
}
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
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
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webauthn_credentials (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
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
    card_limit INTEGER NOT NULL DEFAULT 0,
    card_locked INTEGER NOT NULL DEFAULT 0,
    estimated_ready_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL
  );
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
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
  CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);
  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_card_requests_user ON card_requests(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_support_requests_user ON support_requests(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status, created_at DESC);
`)

const resetTokenColumns = db.prepare('PRAGMA table_info(password_reset_tokens)').all().map((column) => column.name)
if (!resetTokenColumns.includes('purpose')) {
  db.exec("ALTER TABLE password_reset_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'password'")
}

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
if (!userColumns.includes('card_number')) db.exec('ALTER TABLE users ADD COLUMN card_number TEXT')
if (!userColumns.includes('cvv')) db.exec('ALTER TABLE users ADD COLUMN cvv TEXT')
if (!userColumns.includes('card_limit')) db.exec('ALTER TABLE users ADD COLUMN card_limit INTEGER NOT NULL DEFAULT 1800000')
if (!userColumns.includes('card_locked')) db.exec('ALTER TABLE users ADD COLUMN card_locked INTEGER NOT NULL DEFAULT 0')
if (!userColumns.includes('auth_version')) db.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_card_number ON users(card_number)')

const cardRequestColumns = db.prepare('PRAGMA table_info(card_requests)').all().map((column) => column.name)
if (!cardRequestColumns.includes('card_kind')) db.exec("ALTER TABLE card_requests ADD COLUMN card_kind TEXT NOT NULL DEFAULT 'debit' CHECK (card_kind IN ('debit', 'credit'))")
if (!cardRequestColumns.includes('card_number')) db.exec('ALTER TABLE card_requests ADD COLUMN card_number TEXT')
if (!cardRequestColumns.includes('cvv')) db.exec('ALTER TABLE card_requests ADD COLUMN cvv TEXT')
if (!cardRequestColumns.includes('card_status')) db.exec("ALTER TABLE card_requests ADD COLUMN card_status TEXT NOT NULL DEFAULT 'pending' CHECK (card_status IN ('pending', 'active', 'rejected'))")
if (!cardRequestColumns.includes('card_limit')) db.exec('ALTER TABLE card_requests ADD COLUMN card_limit INTEGER NOT NULL DEFAULT 0')
if (!cardRequestColumns.includes('card_locked')) db.exec('ALTER TABLE card_requests ADD COLUMN card_locked INTEGER NOT NULL DEFAULT 0')
if (!cardRequestColumns.includes('estimated_ready_at')) db.exec('ALTER TABLE card_requests ADD COLUMN estimated_ready_at TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_card_requests_card_number ON card_requests(card_number) WHERE card_number IS NOT NULL')
db.prepare("UPDATE card_requests SET card_status = 'rejected' WHERE status = 'rejected'").run()

const transactionColumns = db.prepare('PRAGMA table_info(transactions)').all().map((column) => column.name)
if (!transactionColumns.includes('counterparty_user_id')) db.exec('ALTER TABLE transactions ADD COLUMN counterparty_user_id TEXT REFERENCES users(id)')
if (!transactionColumns.includes('account_id')) db.exec('ALTER TABLE transactions ADD COLUMN account_id TEXT')
if (!transactionColumns.includes('counterparty_account_id')) db.exec('ALTER TABLE transactions ADD COLUMN counterparty_account_id TEXT')
if (!transactionColumns.includes('reference')) db.exec('ALTER TABLE transactions ADD COLUMN reference TEXT')
if (!transactionColumns.includes('idempotency_key')) db.exec('ALTER TABLE transactions ADD COLUMN idempotency_key TEXT')

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('checking', 'pocket', 'treasury', 'loan_receivable')),
    name TEXT NOT NULL,
    goal INTEGER,
    balance INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_checking ON accounts(user_id) WHERE kind = 'checking';
  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id, kind);

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_account_date ON ledger_entries(account_id, created_at);

  CREATE TABLE IF NOT EXISTS aviator_rounds (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('betting', 'flying', 'crashed')),
    server_seed_hash TEXT NOT NULL,
    server_seed TEXT,
    crash_point REAL NOT NULL,
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
    amount INTEGER NOT NULL CHECK (amount > 0),
    auto_cashout REAL,
    status TEXT NOT NULL CHECK (status IN ('active', 'cashed_out', 'lost', 'refunded')),
    cashout_multiplier REAL,
    payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
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
    max_bet INTEGER NOT NULL DEFAULT 500000 CHECK (max_bet > 0),
    daily_bet_limit INTEGER NOT NULL DEFAULT 2000000 CHECK (daily_bet_limit > 0),
    daily_loss_limit INTEGER NOT NULL DEFAULT 500000 CHECK (daily_loss_limit > 0),
    self_excluded_until TEXT,
    age_verified_at TEXT
  );

  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    term INTEGER NOT NULL,
    rate_basis_points INTEGER NOT NULL,
    total_payable INTEGER NOT NULL,
    remaining_balance INTEGER NOT NULL,
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
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id, created_at);

  CREATE TABLE IF NOT EXISTS investment_positions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    symbol TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    shares_scaled INTEGER NOT NULL CHECK (shares_scaled > 0),
    purchase_price INTEGER NOT NULL CHECK (purchase_price > 0),
    term_days INTEGER NOT NULL CHECK (term_days IN (7, 30, 90, 180)),
    matures_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    payout INTEGER,
    purchase_transaction_id TEXT NOT NULL REFERENCES transactions(id),
    close_transaction_id TEXT REFERENCES transactions(id),
    created_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_investment_positions_user ON investment_positions(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_investment_positions_maturity ON investment_positions(status, matures_at);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference) WHERE reference IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  UPDATE transactions SET status = 'Procesado' WHERE lower(status) IN ('completed', 'completado');
`)

const now = () => new Date().toISOString()
const seedUser = db.prepare('SELECT id FROM users WHERE email = ?').get('ana@gmail.com')
if (!seedUser) {
  const timestamp = now()
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, document, phone, email, password_hash, pin_hash, role, trust_score, created_at, updated_at)
    VALUES (@id, @firstName, @lastName, @document, @phone, @email, @passwordHash, @pinHash, 'user', 82, @timestamp, @timestamp)
  `).run({
    id: 'demo-user-fastbank',
    firstName: 'Ana',
    lastName: 'García',
    document: '1002345678',
    phone: '3001234567',
    email: 'ana@gmail.com',
    passwordHash: bcrypt.hashSync('REMOVED', 12),
    pinHash: bcrypt.hashSync('REMOVED', 12),
    timestamp,
  })
}

const seedAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('fastbank@gmail.com')
if (!seedAdmin) {
  const timestamp = now()
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, document, phone, email, password_hash, pin_hash, role, trust_score, created_at, updated_at)
    VALUES (@id, @firstName, @lastName, @document, @phone, @email, @passwordHash, @pinHash, 'admin', 99, @timestamp, @timestamp)
  `).run({
    id: 'admin-fastbank',
    firstName: 'Fastbank',
    lastName: 'Admin',
    document: '9000000000',
    phone: '3018489400',
    email: 'fastbank@gmail.com',
    passwordHash: bcrypt.hashSync('REMOVED', 12),
    pinHash: bcrypt.hashSync('REMOVED', 12),
    timestamp,
  })
}

db.prepare('UPDATE users SET card_number = NULL, cvv = NULL WHERE card_number IS NOT NULL OR cvv IS NOT NULL').run()

const createAccount = db.prepare(`
  INSERT OR IGNORE INTO accounts (id, user_id, kind, name, balance, created_at)
  VALUES (?, ?, ?, ?, 0, ?)
`)
const systemAccounts = [
  ['system-treasury', 'treasury', 'Capital del simulador'],
  ['system-loan-receivable', 'loan_receivable', 'Cartera de crédito'],
  ['system-interest-income', 'treasury', 'Ingresos por intereses'],
  ['system-investment-holdings', 'treasury', 'Custodia de inversiones'],
  ['system-service-clearing', 'treasury', 'Compensación de pagos de servicios'],
  ['casino-house', 'treasury', 'casino/house'],
]
for (const [id, kind, name] of systemAccounts) createAccount.run(id, null, kind, name, now())

const houseBankroll = Number(process.env.CASINO_HOUSE_BANKROLL || 1000000000)
if (!Number.isSafeInteger(houseBankroll) || houseBankroll < 0) {
  throw new Error('CASINO_HOUSE_BANKROLL debe ser un entero no negativo en COP.')
}
if (houseBankroll > 0 && !db.prepare('SELECT id FROM transactions WHERE reference = ?').get('casino:house:opening')) {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get()
  if (!admin) throw new Error('No existe una cuenta administrativa para registrar el capital inicial del casino.')
  const transactionId = crypto.randomUUID()
  const createdAt = now()
  const openCasinoHouse = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, reference)
      VALUES (?, ?, 'income', ?, 'Capital inicial de casino/house', 'Casino', 'Procesado', ?, 'system-treasury', 'casino-house', 'casino:house:opening')
    `).run(transactionId, admin.id, houseBankroll, createdAt)
    db.prepare(`
      INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
      VALUES (?, ?, 'system-treasury', 'debit', ?, ?), (?, ?, 'casino-house', 'credit', ?, ?)
    `).run(crypto.randomUUID(), transactionId, houseBankroll, createdAt, crypto.randomUUID(), transactionId, houseBankroll, createdAt)
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id IN (?, ?)').run(houseBankroll, 'system-treasury', 'casino-house')
  })
  openCasinoHouse()
}

const users = db.prepare('SELECT id, first_name, last_name, created_at FROM users').all()
for (const user of users) {
  createAccount.run(`checking-${user.id}`, user.id, 'checking', 'Cuenta principal', now())
}

const demoUser = db.prepare('SELECT id FROM users WHERE id = ?').get('demo-user-fastbank')
if (demoUser && !db.prepare('SELECT id FROM transactions WHERE reference = ?').get('opening:demo-user-fastbank')) {
  const accountId = `checking-${demoUser.id}`
  const transactionId = crypto.randomUUID()
  const createdAt = now()
  const amount = 1000000
  const openDemoAccount = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, reference)
      VALUES (?, ?, 'income', ?, 'Saldo inicial de demostración', 'Apertura', 'Procesado', ?, ?, 'system-treasury', 'opening:demo-user-fastbank')
    `).run(transactionId, demoUser.id, amount, createdAt, accountId)
    db.prepare(`
      INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
      VALUES (?, ?, 'system-treasury', 'debit', ?, ?), (?, ?, ?, 'credit', ?, ?)
    `).run(crypto.randomUUID(), transactionId, amount, createdAt, crypto.randomUUID(), transactionId, accountId, amount, createdAt)
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(amount, 'system-treasury')
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(amount, accountId)
  })
  openDemoAccount()
}

export const publicUser = (user) => ({
  id: user.id,
  firstName: user.first_name,
  lastName: user.last_name,
  document: user.document,
  phone: user.phone,
  email: user.email,
  role: user.role,
  status: user.status,
  trustScore: user.trust_score,
  twoFactorEnabled: Boolean(user.totp_enabled),
  cardNumber: null,
  cardLimit: null,
  creditCardLimit: user.card_limit,
  cardLocked: false,
})

export const audit = (userId, action, metadata = {}, ipAddress = null) => {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, metadata, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, action, JSON.stringify(metadata), ipAddress, now())
}
