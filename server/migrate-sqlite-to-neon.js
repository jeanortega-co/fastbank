import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import pg from 'pg'
import { POSTGRES_SCHEMA, SQLITE_IMPORT_TABLES } from './postgres-schema.js'

const { Pool } = pg
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(process.env.DATABASE_PATH || resolve(root, 'data', 'fastbank.sqlite'))
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set to the Neon PostgreSQL connection string.')
}
if (!existsSync(sourcePath)) {
  throw new Error('The configured SQLite source database does not exist.')
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = resolve(dirname(sourcePath), `${basename(sourcePath)}.migration-backup-${timestamp}`)
if (existsSync(backupPath)) {
  throw new Error('The SQLite backup destination already exists; refusing to overwrite it.')
}

const sourceForBackup = new Database(sourcePath, { readonly: true, fileMustExist: true })
let source
let pool
let client
let transactionOpen = false

const hashFile = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolveHash(hash.digest('hex')))
})

const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`
const sourceColumns = (table) => source.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
const primaryKeyColumns = (columns) => columns
  .filter((column) => column.pk)
  .sort((left, right) => left.pk - right.pk)
  .map((column) => column.name)

const readSourceLedger = () => {
  const balances = new Map()
  for (const row of source.prepare('SELECT id, balance FROM accounts').iterate()) {
    balances.set(row.id, String(row.balance))
  }
  const totals = new Map()
  for (const row of source.prepare('SELECT account_id, side, amount FROM ledger_entries').iterate()) {
    const current = totals.get(row.account_id) || { debit: 0n, credit: 0n }
    current[row.side] += BigInt(row.amount)
    totals.set(row.account_id, current)
  }
  return { balances, totals }
}

const readTargetLedger = async (targetAccountIds) => {
  const result = await client.query(
    'SELECT id, balance FROM accounts WHERE id = ANY($1::text[])',
    [targetAccountIds],
  )
  const balances = new Map(result.rows.map((row) => [row.id, String(row.balance)]))
  const totals = new Map()
  if (targetAccountIds.length) {
    const entries = await client.query(
      'SELECT account_id, side, amount FROM ledger_entries WHERE account_id = ANY($1::text[])',
      [targetAccountIds],
    )
    for (const row of entries.rows) {
      const current = totals.get(row.account_id) || { debit: 0n, credit: 0n }
      current[row.side] += BigInt(row.amount)
      totals.set(row.account_id, current)
    }
  }
  return { balances, totals }
}

const assertLedgerEqual = async () => {
  const expected = readSourceLedger()
  const actual = await readTargetLedger([...expected.balances.keys()])
  if (expected.balances.size !== actual.balances.size) {
    throw new Error('Ledger validation failed: account counts differ.')
  }
  for (const [accountId, balance] of expected.balances) {
    const actualBalance = actual.balances.get(accountId)
    const expectedTotals = expected.totals.get(accountId) || { debit: 0n, credit: 0n }
    const actualTotals = actual.totals.get(accountId) || { debit: 0n, credit: 0n }
    if (
      actualBalance !== balance
      || actualTotals.debit !== expectedTotals.debit
      || actualTotals.credit !== expectedTotals.credit
    ) {
      throw new Error('Ledger validation failed: account balances or entry totals differ.')
    }
  }
}

const run = async () => {
  mkdirSync(dirname(backupPath), { recursive: true })
  const backupReservation = openSync(backupPath, 'wx')
  closeSync(backupReservation)

  try {
    await sourceForBackup.backup(backupPath)
  } finally {
    sourceForBackup.close()
  }

  const sourceFingerprint = await hashFile(backupPath)
  source = new Database(backupPath, { readonly: true, fileMustExist: true })
  const sourceTableNames = new Set(source.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all().map(({ name }) => name))
  const missingTables = SQLITE_IMPORT_TABLES.filter((table) => !sourceTableNames.has(table))
  if (missingTables.length) {
    throw new Error('The SQLite database schema is incomplete; no data was imported.')
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  })
  client = await pool.connect()
  const importCounts = {}
  let insertedRows = 0

  try {
    await client.query('BEGIN')
    transactionOpen = true
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fastbank:sqlite-import:v1'))")
    await client.query(POSTGRES_SCHEMA)
    await client.query(`
      CREATE TABLE IF NOT EXISTS fastbank_migration_history (
        migration_key TEXT PRIMARY KEY,
        completed_at TEXT NOT NULL,
        source_row_counts JSONB NOT NULL
      )
    `)

    for (const table of SQLITE_IMPORT_TABLES) {
      const columns = sourceColumns(table)
      const columnNames = columns.map((column) => column.name)
      const keys = primaryKeyColumns(columns)
      if (!keys.length) throw new Error(`The source table ${table} has no primary key.`)
      const namesSql = columnNames.map(quoteIdentifier).join(', ')
      const placeholders = columnNames.map((_, index) => `$${index + 1}`).join(', ')
      const insert = `INSERT INTO ${quoteIdentifier(table)} (${namesSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING 1`
      const values = source.prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
      const count = Number(source.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count)
      let verifiedRows = 0

      for (const row of values.iterate()) {
        const rowValues = columnNames.map((column) => row[column])
        const inserted = await client.query(insert, rowValues)
        if (inserted.rowCount) insertedRows += 1
        const exactMatch = columnNames
          .map((column, index) => `${quoteIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`)
          .join(' AND ')
        const matched = await client.query(
          `SELECT 1 FROM ${quoteIdentifier(table)} WHERE ${exactMatch} LIMIT 1`,
          rowValues,
        )
        if (!matched.rowCount) {
          throw new Error(`Migration conflict in ${table}; an existing Neon row differs from the SQLite source.`)
        }
        verifiedRows += 1
      }

      if (verifiedRows !== count) throw new Error(`Row count validation failed for ${table}.`)
      importCounts[table] = count
    }

    await assertLedgerEqual()
    await client.query(
      `INSERT INTO fastbank_migration_history (migration_key, completed_at, source_row_counts)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (migration_key) DO NOTHING`,
      [sourceFingerprint, new Date().toISOString(), JSON.stringify(importCounts)],
    )
    await client.query('COMMIT')
    transactionOpen = false
    console.log(`SQLite import complete: ${Object.values(importCounts).reduce((sum, count) => sum + count, 0)} rows verified across ${SQLITE_IMPORT_TABLES.length} tables; ${insertedRows} new rows inserted.`)
    console.log(`Consistent SQLite backup: ${backupPath}`)
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK')
    transactionOpen = false
    throw error
  } finally {
    source.close()
    client.release()
    await pool.end()
  }
}

run().catch((error) => {
  console.error(`SQLite import failed${error?.code ? ` (database error ${error.code})` : ''}. No row contents or credentials were logged.`)
  process.exitCode = 1
})
