import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'
import { calculateCrashPoint } from '../server/services/aviator.js'

const testDirectory = mkdtempSync(join(tmpdir(), 'fastbank-aviator-'))
process.env.NODE_ENV = 'test'
process.env.DATABASE_PATH = join(testDirectory, 'fastbank.sqlite')
process.env.JWT_SECRET = randomBytes(32).toString('hex')
process.env.CLIENT_ORIGIN = 'http://localhost:5173'
process.env.FASTBANK_SEED_DEMO_USERS = 'true'
process.env.DEMO_USER_PASSWORD = randomBytes(32).toString('hex')
process.env.DEMO_USER_PIN = String(randomInt(1000, 10000))
process.env.DEMO_ADMIN_PASSWORD = randomBytes(32).toString('hex')
process.env.DEMO_ADMIN_PIN = String(randomInt(1000, 10000))
process.env.SMTP_HOST = ''
process.env.SMTP_PORT = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''
process.env.SMTP_FROM = ''

const { app, banking, db } = await import('../server/index.js')
banking.aviator.start()
banking.aviator.stop()
const server = app.listen(0)
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

const fixtureUserId = 'aviator-test-user'
const fixtureAccountId = `checking-${fixtureUserId}`
const token = jwt.sign({ sub: fixtureUserId, role: 'user', authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '2h' })
const now = () => new Date().toISOString()

const request = async (path, { method = 'GET', body, authorization = token, headers = {} } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, data: await response.json() }
}

const createFixtureUser = () => {
  const timestamp = now()
  db.prepare('DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)').run(fixtureUserId)
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM accounts WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM audit_logs WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM card_requests WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM support_requests WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM aviator_bets WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM casino_limits WHERE user_id = ?').run(fixtureUserId)
  db.prepare('DELETE FROM users WHERE id = ?').run(fixtureUserId)
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, document, phone, email, password_hash, pin_hash, role, status, trust_score, created_at, updated_at)
    VALUES (?, 'Casino', 'Tester', '9999988888', '3009998888', 'aviator-test@example.test', 'unused', 'unused', 'user', 'active', 60, ?, ?)
  `).run(fixtureUserId, timestamp, timestamp)
  db.prepare(`
    INSERT INTO accounts (id, user_id, kind, name, balance, created_at)
    VALUES (?, ?, 'checking', 'Cuenta principal', 0, ?)
  `).run(fixtureAccountId, fixtureUserId, timestamp)

  const transactionId = randomUUID()
  const amount = 1000
  db.prepare(`
    INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, reference)
    VALUES (?, ?, 'income', ?, 'Saldo de prueba', 'Apertura', 'Procesado', ?, 'system-treasury', ?, 'aviator-test:opening')
  `).run(transactionId, fixtureUserId, amount, timestamp, fixtureAccountId)
  db.prepare(`
    INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
    VALUES (?, ?, 'system-treasury', 'debit', ?, ?), (?, ?, ?, 'credit', ?, ?)
  `).run(randomUUID(), transactionId, amount, timestamp, randomUUID(), transactionId, fixtureAccountId, amount, timestamp)
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id IN (?, ?)').run(amount, 'system-treasury', fixtureAccountId)
}

const addFixtureFunds = (amount) => {
  const timestamp = now()
  const transactionId = randomUUID()
  db.prepare(`
    INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, reference)
    VALUES (?, ?, 'income', ?, 'Saldo de prueba adicional', 'Apertura', 'Procesado', ?, 'system-treasury', ?, ?)
  `).run(transactionId, fixtureUserId, amount, timestamp, fixtureAccountId, `aviator-test:funds:${randomUUID()}`)
  db.prepare(`
    INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
    VALUES (?, ?, 'system-treasury', 'debit', ?, ?), (?, ?, ?, 'credit', ?, ?)
  `).run(randomUUID(), transactionId, amount, timestamp, randomUUID(), transactionId, fixtureAccountId, amount, timestamp)
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id IN (?, ?)').run(amount, 'system-treasury', fixtureAccountId)
}

const assertLedgerBalanced = () => {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN side = 'debit' THEN amount ELSE 0 END), 0) AS debits,
      COALESCE(SUM(CASE WHEN side = 'credit' THEN amount ELSE 0 END), 0) AS credits
    FROM ledger_entries
  `).get()
  assert.equal(totals.debits, totals.credits)

  const checking = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId)
  const checkingLedger = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN side = 'credit' THEN amount ELSE -amount END), 0) AS balance
    FROM ledger_entries WHERE account_id = ?
  `).get(fixtureAccountId)
  assert.equal(checking.balance, checkingLedger.balance)

  const house = db.prepare("SELECT balance FROM accounts WHERE id = 'casino-house'").get()
  const houseLedger = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN side = 'credit' THEN amount ELSE -amount END), 0) AS balance
    FROM ledger_entries WHERE account_id = 'casino-house'
  `).get()
  assert.equal(house.balance, houseLedger.balance)
}

const forceBetting = (roundId, crashPoint) => {
  db.prepare(`
    UPDATE aviator_rounds
    SET status = 'betting', crash_point = ?, started_at = NULL, crashed_at = NULL,
      betting_ends_at = ?
    WHERE id = ?
  `).run(crashPoint, new Date(Date.now() + 60000).toISOString(), roundId)
}

const createRoundAbove = (minimumCrashPoint) => {
  let round
  for (let attempt = 0; attempt < 30; attempt += 1) {
    round = banking.aviator.createRound()
    if (round.crash_point > minimumCrashPoint) return round
    db.prepare("UPDATE aviator_rounds SET status = 'crashed', crashed_at = ? WHERE id = ?")
      .run(now(), round.id)
  }
  throw new Error(`Could not create a test round above ${minimumCrashPoint}x.`)
}

after(() => {
  banking.aviator.stop()
  server.close()
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test('Aviator transactions are atomic, idempotent and recoverable', async () => {
  createFixtureUser()

  let result = await request('/api/casino/limits', {
    method: 'PUT',
    body: { maxBet: 500000, dailyBetLimit: 2000000, dailyLossLimit: 500000 },
  })
  assert.equal(result.status, 200)
  assertLedgerBalanced()

  result = await request('/api/casino/limits')
  assert.equal(result.status, 200)
  assert.equal(result.data.limits.maxBet, 500000)
  assertLedgerBalanced()

  let round = banking.aviator.getCurrentRound()
  assert.ok(round)
  const state = await request('/api/casino/aviator/state')
  assert.equal(state.status, 200)
  assert.equal(state.data.round.id, round.id)
  assert.equal(state.data.round.status, 'betting')

  result = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 1, amount: 2000, idempotency_key: 'insufficient-balance' },
  })
  assert.equal(result.status, 409)
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance, 1000)
  assertLedgerBalanced()

  db.prepare(`
    UPDATE aviator_rounds SET status = 'flying', crash_point = 100, started_at = ? WHERE id = ?
  `).run(now(), round.id)
  result = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 1, amount: 1000, idempotency_key: 'outside-betting-phase' },
  })
  assert.equal(result.status, 409)
  assertLedgerBalanced()

  db.prepare("UPDATE aviator_rounds SET status = 'crashed', crashed_at = ? WHERE id = ?")
    .run(now(), round.id)
  round = createRoundAbove(1.7)
  forceBetting(round.id, round.crash_point)

  result = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 1, amount: 1000, idempotency_key: 'same-bet-key' },
  })
  assert.equal(result.status, 201)
  const betId = result.data.bet.id
  assertLedgerBalanced()

  const replay = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 1, amount: 1000, idempotency_key: 'same-bet-key' },
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.data.bet.id, betId)
  assertLedgerBalanced()

  const duplicateKey = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 2, amount: 1000, idempotency_key: 'same-bet-key' },
  })
  assert.equal(duplicateKey.status, 409)
  assertLedgerBalanced()

  db.prepare("UPDATE aviator_rounds SET status = 'flying', started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 5000).toISOString(), round.id)
  const cashout = await request('/api/casino/aviator/cashout', { method: 'POST', body: { slot: 1 } })
  assert.equal(cashout.status, 200)
  assert.equal(cashout.data.bet.status, 'cashed_out')
  assert.ok(cashout.data.bet.payout > 1000)
  assertLedgerBalanced()

  const balanceAfterCashout = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance
  const duplicateCashout = await request('/api/casino/aviator/cashout', { method: 'POST', body: { slot: 1 } })
  assert.equal(duplicateCashout.status, 409)
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance, balanceAfterCashout)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND idempotency_key = ?")
    .get(fixtureUserId, `aviator:payout:${betId}`).count, 1)
  assertLedgerBalanced()

  const crashStart = Date.now() - Math.ceil(Math.log(round.crash_point + 0.2) * 10000)
  db.prepare('UPDATE aviator_rounds SET started_at = ? WHERE id = ?').run(new Date(crashStart).toISOString(), round.id)
  banking.aviator.advance()
  const proof = await request(`/api/casino/aviator/verify/${round.id}`)
  assert.equal(proof.status, 200)
  assert.equal(proof.data.serverSeedHash, createHash('sha256').update(proof.data.serverSeed).digest('hex'))
  assert.equal(proof.data.crashPoint, round.crash_point)
  const history = await request('/api/casino/aviator/history')
  assert.equal(history.status, 200)
  assert.ok(history.data.rounds.some((entry) => entry.id === round.id))
  const transactions = await request('/api/transactions')
  assert.ok(transactions.data.transactions.some((entry) => entry.category === 'Casino'))
  assertLedgerBalanced()

  addFixtureFunds(5000)
  assertLedgerBalanced()
  round = createRoundAbove(1.2)
  forceBetting(round.id, round.crash_point)
  const autoBet = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 1, amount: 1000, auto_cashout: 1.2, idempotency_key: 'auto-cashout-bet' },
  })
  assert.equal(autoBet.status, 201)
  db.prepare("UPDATE aviator_rounds SET status = 'flying', started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 2500).toISOString(), round.id)
  banking.aviator.advance()
  const autoSettled = db.prepare('SELECT status, payout, cashout_multiplier FROM aviator_bets WHERE id = ?')
    .get(autoBet.data.bet.id)
  assert.equal(autoSettled.status, 'cashed_out')
  assert.equal(autoSettled.cashout_multiplier, 1.2)
  assert.equal(autoSettled.payout, 1200)
  assertLedgerBalanced()

  const autoCrashStart = Date.now() - Math.ceil(Math.log(round.crash_point + 0.2) * 10000)
  db.prepare('UPDATE aviator_rounds SET started_at = ? WHERE id = ?').run(new Date(autoCrashStart).toISOString(), round.id)
  banking.aviator.advance()
  assert.equal((await request(`/api/casino/aviator/verify/${round.id}`)).status, 200)
  assertLedgerBalanced()

  round = banking.aviator.createRound()
  forceBetting(round.id, round.crash_point)
  const balanceBeforeLoss = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance
  const losingBet = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 2, amount: 1000, idempotency_key: 'losing-bet' },
  })
  assert.equal(losingBet.status, 201)
  const balanceAfterLossStake = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance
  assert.equal(balanceAfterLossStake, balanceBeforeLoss - 1000)
  db.prepare("UPDATE aviator_rounds SET status = 'flying', started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - Math.ceil(Math.log(round.crash_point + 0.2) * 10000)).toISOString(), round.id)
  banking.aviator.advance()
  assert.equal(db.prepare('SELECT status FROM aviator_bets WHERE id = ?').get(losingBet.data.bet.id).status, 'lost')
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance, balanceAfterLossStake)
  assert.equal((await request(`/api/casino/aviator/verify/${round.id}`)).status, 200)
  assertLedgerBalanced()

  round = banking.aviator.createRound()
  forceBetting(round.id, round.crash_point)
  const interruptedBet = await request('/api/casino/aviator/bet', {
    method: 'POST',
    body: { slot: 1, amount: 1000, idempotency_key: 'interrupted-bet' },
  })
  assert.equal(interruptedBet.status, 201)
  const balanceBeforeRefund = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance
  banking.aviator.start()
  banking.aviator.stop()
  const refunded = db.prepare('SELECT status, payout FROM aviator_bets WHERE id = ?').get(interruptedBet.data.bet.id)
  assert.equal(refunded.status, 'refunded')
  assert.equal(refunded.payout, 1000)
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance, balanceBeforeRefund + 1000)
  assertLedgerBalanced()

  const exclusionUntil = new Date(Date.now() + 86400000).toISOString()
  result = await request('/api/casino/limits', { method: 'PUT', body: { selfExcludedUntil: exclusionUntil } })
  assert.equal(result.status, 200)
  const shortenedExclusion = await request('/api/casino/limits', {
    method: 'PUT',
    body: { selfExcludedUntil: null },
  })
  assert.equal(shortenedExclusion.status, 400)
  assertLedgerBalanced()
})

test('Aviator state hides crash data before the crash and stream tickets are single-use', async () => {
  createFixtureUser()
  const limits = await request('/api/casino/limits', { method: 'PUT', body: { maxBet: 500000, dailyBetLimit: 2000000, dailyLossLimit: 500000 } })
  assert.equal(limits.status, 200)

  const round = banking.aviator.createRound()
  forceBetting(round.id, round.crash_point)
  const bettingState = await request('/api/casino/aviator/state')
  assert.equal(bettingState.status, 200)
  assert.ok(Object.hasOwn(bettingState.data.round, 'serverSeedHash'))
  assert.ok(!Object.hasOwn(bettingState.data.round, 'crashPoint'))

  db.prepare("UPDATE aviator_rounds SET status = 'flying', crash_point = 1000, started_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 5000).toISOString(), round.id)

  const flyingState = await request('/api/casino/aviator/state')
  assert.equal(flyingState.status, 200)
  assert.ok(!Object.hasOwn(flyingState.data.round, 'crashPoint'))

  const ticketRequest = await request('/api/casino/aviator/stream-ticket', { method: 'POST' })
  assert.equal(ticketRequest.status, 200)
  assert.ok(ticketRequest.data.ticket)

  const controller = new AbortController()
  const streamTimer = setTimeout(() => controller.abort(), 1500)
  const firstStream = await fetch(`${origin}/api/casino/aviator/stream?ticket=${encodeURIComponent(ticketRequest.data.ticket)}`, { signal: controller.signal })
  clearTimeout(streamTimer)
  assert.equal(firstStream.status, 200)
  assert.ok(firstStream.headers.get('content-type')?.includes('text/event-stream'))
  await firstStream.body?.cancel().catch(() => {})

  const replayStream = await fetch(`${origin}/api/casino/aviator/stream?ticket=${encodeURIComponent(ticketRequest.data.ticket)}`)
  assert.equal(replayStream.status, 401)
  assert.ok(!replayStream.headers.get('content-type')?.includes('text/event-stream'))
})

test('Aviator state request advances and closes an expired flying round', async () => {
  createFixtureUser()
  const round = banking.aviator.createRound()
  db.prepare(`
    UPDATE aviator_rounds
    SET status = 'flying', crash_point = 1.01, started_at = ?, betting_ends_at = ?
    WHERE id = ?
  `).run(new Date(Date.now() - 60000).toISOString(), new Date(Date.now() - 70000).toISOString(), round.id)

  const result = await request('/api/casino/aviator/state')
  assert.equal(result.status, 200)
  assert.equal(result.data.round.status, 'crashed')
  assert.equal(result.data.round.crashPoint, 1.01)
})

test('Aviator betting works in betting phase and fails clearly outside of it', async () => {
  createFixtureUser()
  addFixtureFunds(250000)

  let result = await request('/api/casino/limits', {
    method: 'PUT',
    body: { maxBet: 500000, dailyBetLimit: 2000000, dailyLossLimit: 500000 },
  })
  assert.equal(result.status, 200)

  const round = banking.aviator.createRound()
  forceBetting(round.id, round.crash_point)

  const beforeBalance = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance
  result = await request('/api/casino/aviator/bet', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { slot: 1, amount: 10000, auto_cashout: 2.5 },
  })
  assert.equal(result.status, 201)
  assert.equal(result.data.bet.status, 'active')
  assert.equal(result.data.bet.amount, 10000)

  const afterBetBalance = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fixtureAccountId).balance
  assert.equal(afterBetBalance, beforeBalance - 10000)

  db.prepare(`
    UPDATE aviator_rounds
    SET status = 'flying', started_at = ?, betting_ends_at = ?
    WHERE id = ?
  `).run(new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 5000).toISOString(), round.id)

  result = await request('/api/casino/aviator/bet', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { slot: 2, amount: 5000 },
  })
  assert.equal(result.status, 409)
  assert.match(String(result.data.message || ''), /fase de apuestas|betting/i)
})

test('100,000 deterministic crash points target approximately 97% RTP', () => {
  const rounds = 100000
  const targetMultiplier = 2
  let wins = 0
  for (let index = 0; index < rounds; index += 1) {
    const seed = randomBytes(32).toString('hex')
    const crashPoint = calculateCrashPoint(seed, `simulation-${index}`)
    if (crashPoint >= targetMultiplier) wins += 1
  }
  const returnToPlayer = wins * targetMultiplier / rounds
  console.log(`Aviator simulation: ${rounds} rounds, 2.00x RTP ${(returnToPlayer * 100).toFixed(2)}% (target 97%).`)
  assert.ok(returnToPlayer > 0.96 && returnToPlayer < 0.98, `Observed RTP was ${(returnToPlayer * 100).toFixed(2)}%.`)
})
