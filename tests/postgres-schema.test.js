import test from 'node:test'
import assert from 'node:assert/strict'
import { POSTGRES_SCHEMA, SQLITE_IMPORT_TABLES } from '../server/postgres-schema.js'

test('PostgreSQL schema covers every SQLite application table in import order', () => {
  const expectedTables = [
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

  assert.deepEqual(SQLITE_IMPORT_TABLES, expectedTables)
  for (const table of expectedTables) {
    assert.match(POSTGRES_SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`))
  }
  assert.ok(SQLITE_IMPORT_TABLES.indexOf('users') < SQLITE_IMPORT_TABLES.indexOf('accounts'))
  assert.ok(SQLITE_IMPORT_TABLES.indexOf('transactions') < SQLITE_IMPORT_TABLES.indexOf('ledger_entries'))
  assert.ok(SQLITE_IMPORT_TABLES.indexOf('aviator_rounds') < SQLITE_IMPORT_TABLES.indexOf('aviator_bets'))
  assert.ok(SQLITE_IMPORT_TABLES.indexOf('loans') < SQLITE_IMPORT_TABLES.indexOf('loan_payments'))
})

test('PostgreSQL schema retains uniqueness and ledger safety constraints', () => {
  assert.match(POSTGRES_SCHEMA, /UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency/)
  assert.match(POSTGRES_SCHEMA, /UNIQUE \(round_id, user_id, slot\)/)
  assert.match(POSTGRES_SCHEMA, /UNIQUE \(user_id, idempotency_key\)/)
  assert.match(POSTGRES_SCHEMA, /CHECK \(amount > 0\)/)
})
