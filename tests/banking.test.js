import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { sendPasswordResetEmail, sendRegistrationVerificationEmail } from '../server/email.js'

const testDirectory = mkdtempSync(join(tmpdir(), 'fastbank-banking-'))
process.env.DATABASE_PATH = join(testDirectory, 'fastbank.sqlite')
process.env.JWT_SECRET = 'REMOVED'
process.env.CLIENT_ORIGIN = 'http://localhost:5173,http://192.168.1.50:5173,https://fastbank-5173.example-tunnel'
process.env.SMTP_HOST = ''
process.env.SMTP_PORT = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''
process.env.SMTP_FROM = ''

const { app, db } = await import('../server/index.js')
const server = app.listen(0)
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

const request = async (path, { token, ...options } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  return { status: response.status, data: await response.json() }
}

const login = async (identifier, password, pin) => {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password, pin }),
  })
  assert.equal(result.status, 200)
  return result.data.token
}

after(() => {
  server.close()
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test('CORS permite la interfaz servida desde otro dispositivo autorizado', async () => {
  const response = await fetch(`${origin}/api/health`, {
    headers: { Origin: 'http://192.168.1.50:5173' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://192.168.1.50:5173')
})

test('password reset email uses the registered address and includes the expiring one-time code', async () => {
  let transportOptions
  let sentMessage
  await sendPasswordResetEmail({
    to: 'customer@example.test',
    token: '41862',
    expiresAt: '2026-10-06T20:00:00.000Z',
    env: {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'sender@example.test',
      SMTP_PASS: 'REMOVED',
      SMTP_FROM: 'Fastbank <sender@example.test>',
    },
    createTransport(options) {
      transportOptions = options
      return {
        async sendMail(message) {
          sentMessage = message
        },
      }
    },
  })

  assert.equal(transportOptions.host, 'smtp.example.test')
  assert.equal(transportOptions.port, 465)
  assert.equal(transportOptions.secure, true)
  assert.equal(sentMessage.to, 'customer@example.test')
  assert.match(sentMessage.text, /\b41862\b/)
  assert.match(sentMessage.html, /\b41862\b/)
  await sendPasswordResetEmail({
    to: 'customer@example.test',
    token: '24681',
    expiresAt: '2026-10-06T20:00:00.000Z',
    purpose: 'pin',
    env: {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'sender@example.test',
      SMTP_PASS: 'REMOVED',
      SMTP_FROM: 'Fastbank <sender@example.test>',
    },
    createTransport() {
      return {
        async sendMail(message) {
          sentMessage = message
        },
      }
    },
  })
  assert.match(sentMessage.subject, /PIN/)
  assert.match(sentMessage.text, /restablecer tu PIN/)
})

test('registration verification email sends the five-digit code to the supplied address', async () => {
  let sentMessage
  await sendRegistrationVerificationEmail({
    to: 'new-customer@example.test',
    code: '00427',
    expiresAt: '2026-10-06T20:00:00.000Z',
    env: {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'sender@example.test',
      SMTP_PASS: 'REMOVED',
      SMTP_FROM: 'Fastbank <sender@example.test>',
    },
    createTransport() {
      return {
        async sendMail(message) {
          sentMessage = message
        },
      }
    },
  })

  assert.equal(sentMessage.to, 'new-customer@example.test')
  assert.match(sentMessage.text, /00427/)
  assert.match(sentMessage.html, /00427/)

  await assert.rejects(
    sendRegistrationVerificationEmail({
      to: 'rejected-customer@example.test',
      code: '50123',
      expiresAt: '2026-10-06T20:00:00.000Z',
      env: {
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'sender@example.test',
        SMTP_PASS: 'REMOVED',
        SMTP_FROM: 'Fastbank <sender@example.test>',
      },
      createTransport() {
        return {
          async sendMail() {
            return { accepted: [], rejected: ['rejected-customer@example.test'] }
          },
        }
      },
    }),
    /rechazó la dirección de destino/,
  )
})

test('password reset request validates the email and does not reveal unknown accounts', async () => {
  const invalidEmail = await request('/api/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email' }),
  })
  assert.equal(invalidEmail.status, 400)

  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_USER: 'sender@example.test',
    SMTP_PASS: 'REMOVED',
    SMTP_FROM: 'Fastbank <sender@example.test>',
  })
  const unknownAccount = await request('/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '198.51.100.70' },
    body: JSON.stringify({ email: 'unknown@example.test' }),
  })
  assert.equal(unknownAccount.status, 200)
  assert.match(unknownAccount.data.message, /Si el correo pertenece a una cuenta activa/)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repeatedRequest = await request('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.70' },
      body: JSON.stringify({ email: 'unknown@example.test' }),
    })
    assert.equal(repeatedRequest.status, 200)
  }
  const limitedRequest = await request('/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '198.51.100.70' },
    body: JSON.stringify({ email: 'unknown@example.test' }),
  })
  assert.equal(limitedRequest.status, 429)
  Object.assign(process.env, {
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
  })
})

test('PIN reset request validates the email and does not reveal unknown accounts', async () => {
  const invalidEmail = await request('/api/auth/pin-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email' }),
  })
  assert.equal(invalidEmail.status, 400)

  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_USER: 'sender@example.test',
    SMTP_PASS: 'REMOVED',
    SMTP_FROM: 'Fastbank <sender@example.test>',
  })
  const unknownAccount = await request('/api/auth/pin-reset/request', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '198.51.100.90' },
    body: JSON.stringify({ email: 'unknown-pin@example.test' }),
  })
  assert.equal(unknownAccount.status, 200)
  assert.match(unknownAccount.data.message, /Si el correo pertenece a una cuenta activa/)
  Object.assign(process.env, {
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
  })
})

test('WebAuthn prepara retos de registro y login ligados al dominio autorizado', async () => {
  const anaToken = await login('ana@gmail.com', 'REMOVED', 'REMOVED')
  const origin = 'http://localhost:5173'
  const registration = await request('/api/auth/passkeys/registration-options', {
    method: 'POST',
    token: anaToken,
    headers: { Origin: origin },
    body: JSON.stringify({}),
  })
  assert.equal(registration.status, 200)
  assert.equal(registration.data.options.rp.id, 'localhost')
  assert.equal(registration.data.options.authenticatorSelection.userVerification, 'required')
  const savedRegistrationChallenge = db.prepare('SELECT origin, rp_id, ceremony FROM webauthn_challenges WHERE id = ?').get(registration.data.challengeId)
  assert.deepEqual(savedRegistrationChallenge, { origin, rp_id: 'localhost', ceremony: 'registration' })

  const authentication = await request('/api/auth/passkeys/authentication-options', {
    method: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify({}),
  })
  assert.equal(authentication.status, 200)
  assert.equal(authentication.data.options.rpId, 'localhost')
  assert.equal(authentication.data.options.userVerification, 'required')

  const status = await request('/api/auth/passkeys', { token: anaToken })
  assert.equal(status.status, 200)
  assert.equal(status.data.configured, false)
  assert.equal(status.data.count, 0)
})

test('WebAuthn usa el dominio HTTPS del Referer cuando un túnel reescribe Origin', async () => {
  const anaToken = await login('ana@gmail.com', 'REMOVED', 'REMOVED')
  const registration = await request('/api/auth/passkeys/registration-options', {
    method: 'POST',
    token: anaToken,
    headers: {
      Origin: 'http://localhost:5173',
      Referer: 'https://fastbank-5173.example-tunnel/seguridad',
    },
    body: JSON.stringify({}),
  })
  assert.equal(registration.status, 200)
  assert.equal(registration.data.options.rp.id, 'fastbank-5173.example-tunnel')
  const challenge = db.prepare('SELECT origin, rp_id FROM webauthn_challenges WHERE id = ?').get(registration.data.challengeId)
  assert.deepEqual(challenge, {
    origin: 'https://fastbank-5173.example-tunnel',
    rp_id: 'fastbank-5173.example-tunnel',
  })
})

test('RP ID configurado para túnel no rompe el acceso desde localhost', async () => {
  const previousRpID = process.env.WEBAUTHN_RP_ID
  process.env.WEBAUTHN_RP_ID = 'fastbank-5173.example-tunnel'
  try {
    const anaToken = await login('ana@gmail.com', 'REMOVED', 'REMOVED')
    const optionsFor = async (referer) => request('/api/auth/passkeys/registration-options', {
      method: 'POST',
      token: anaToken,
      headers: { Origin: 'http://localhost:5173', Referer: referer },
      body: JSON.stringify({}),
    })
    const local = await optionsFor('http://localhost:5173/seguridad')
    const tunnel = await optionsFor('https://fastbank-5173.example-tunnel/seguridad')
    assert.equal(local.status, 200)
    assert.equal(local.data.options.rp.id, 'localhost')
    assert.equal(tunnel.status, 200)
    assert.equal(tunnel.data.options.rp.id, 'fastbank-5173.example-tunnel')
  } finally {
    if (previousRpID === undefined) delete process.env.WEBAUTHN_RP_ID
    else process.env.WEBAUTHN_RP_ID = previousRpID
  }
})

test('investment positions debit the account, enforce the agreed term, and pay the closing value once', async () => {
  const token = await login('ana@gmail.com', 'REMOVED', 'REMOVED')
  const account = db.prepare("SELECT id, balance FROM accounts WHERE user_id = 'demo-user-fastbank' AND kind = 'checking'").get()
  const holdings = db.prepare("SELECT balance FROM accounts WHERE id = 'system-investment-holdings'").get()
  const market = await request('/api/investments', { token })
  assert.equal(market.status, 200)
  assert.equal(market.data.instruments.length, 6)
  assert.equal(market.data.instruments[0].history.length, 30)
  assert.equal(market.data.instruments[0].liveCandles.length, 30)
  assert.equal(market.data.instruments[0].liveCandles.at(-1).close, market.data.instruments[0].price)
  assert.ok(new Set(market.data.instruments[0].history.map((point) => point.price)).size > 1)
  assert.equal(market.data.availableBalance, account.balance)

  const invalidTerm = await request('/api/investments', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': 'investment-invalid-term' },
    body: JSON.stringify({ symbol: 'AAPL', amount: 10000, termDays: 5 }),
  })
  assert.equal(invalidTerm.status, 400)

  const purchase = await request('/api/investments', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': 'investment-open-test' },
    body: JSON.stringify({ symbol: 'AAPL', amount: 10000, termDays: 7 }),
  })
  assert.equal(purchase.status, 201)
  const position = purchase.data.investments.positions[0]
  assert.equal(position.symbol, 'AAPL')
  assert.equal(position.termDays, 7)
  assert.equal(position.status, 'active')
  const purchaseQuote = purchase.data.investments.instruments.find((instrument) => instrument.symbol === position.symbol)
  assert.equal(position.currentPrice, purchaseQuote.price)
  assert.equal(position.currentValue, Math.round(position.shares * purchaseQuote.price))
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance, account.balance - 10000)
  const repeatedPurchase = await request('/api/investments', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': 'investment-open-test' },
    body: JSON.stringify({ symbol: 'AAPL', amount: 10000, termDays: 7 }),
  })
  assert.equal(repeatedPurchase.status, 200)
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance, account.balance - 10000)

  const previousTick = purchaseQuote.liveCandles.at(-1).id
  await new Promise((resolve) => setTimeout(resolve, 3100))
  const updatedMarket = await request('/api/investments', { token })
  const updatedQuote = updatedMarket.data.instruments.find((instrument) => instrument.symbol === position.symbol)
  const updatedPosition = updatedMarket.data.positions.find((entry) => entry.id === position.id)
  assert.ok(updatedQuote.liveCandles.at(-1).id > previousTick)
  assert.equal(updatedQuote.liveCandles.at(-1).close, updatedQuote.price)
  assert.equal(updatedPosition.currentPrice, updatedQuote.price)
  assert.equal(updatedPosition.currentValue, Math.round(updatedPosition.shares * updatedQuote.price))
  assert.equal(updatedPosition.profitLoss, updatedPosition.currentValue - updatedPosition.amount)
  if (updatedQuote.price > purchaseQuote.price) assert.ok(updatedPosition.currentValue >= position.currentValue)
  if (updatedQuote.price < purchaseQuote.price) assert.ok(updatedPosition.currentValue <= position.currentValue)

  const earlyWithdrawal = await request(`/api/investments/${position.id}/withdraw`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': 'investment-early-withdraw-test' },
    body: JSON.stringify({}),
  })
  assert.equal(earlyWithdrawal.status, 409)

  db.prepare('UPDATE investment_positions SET matures_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), position.id)
  const maturedMarket = await request('/api/investments', { token })
  const maturedPosition = maturedMarket.data.positions.find((entry) => entry.id === position.id)
  assert.equal(maturedPosition.canWithdraw, true)
  const withdrawal = await request(`/api/investments/${position.id}/withdraw`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': 'investment-close-test' },
    body: JSON.stringify({}),
  })
  assert.equal(withdrawal.status, 200)
  const closedPosition = withdrawal.data.investments.positions.find((entry) => entry.id === position.id)
  assert.equal(closedPosition.status, 'closed')
  assert.equal(closedPosition.payout, maturedPosition.currentValue)
  const expectedBalance = account.balance - 10000 + closedPosition.payout
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance, expectedBalance)

  const repeatedWithdrawal = await request(`/api/investments/${position.id}/withdraw`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': 'investment-close-test' },
    body: JSON.stringify({}),
  })
  assert.equal(repeatedWithdrawal.status, 200)
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance, expectedBalance)

  const transactionIds = db.prepare('SELECT purchase_transaction_id, close_transaction_id FROM investment_positions WHERE id = ?').get(position.id)
  const unbalancedTransactions = db.prepare(`
    SELECT transaction_id
    FROM ledger_entries
    WHERE transaction_id IN (?, ?)
    GROUP BY transaction_id
    HAVING SUM(CASE WHEN side = 'debit' THEN amount ELSE 0 END)
      != SUM(CASE WHEN side = 'credit' THEN amount ELSE 0 END)
  `).all(transactionIds.purchase_transaction_id, transactionIds.close_transaction_id)
  assert.deepEqual(unbalancedTransactions, [])
  db.prepare('DELETE FROM investment_positions WHERE id = ?').run(position.id)
  db.prepare('DELETE FROM ledger_entries WHERE transaction_id IN (?, ?)').run(transactionIds.purchase_transaction_id, transactionIds.close_transaction_id)
  db.prepare('DELETE FROM transactions WHERE id IN (?, ?)').run(transactionIds.purchase_transaction_id, transactionIds.close_transaction_id)
  db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(account.balance, account.id)
  db.prepare("UPDATE accounts SET balance = ? WHERE id = 'system-investment-holdings'").run(holdings.balance)
})

test('banking operations persist atomically with balanced ledger entries', async () => {
  const anaToken = await login('ana@gmail.com', 'REMOVED', 'REMOVED')
  let result = await request('/api/banking/summary', { token: anaToken })
  assert.equal(result.status, 200)
  assert.equal(result.data.account.balance, 1000000)
  assert.equal('cvv' in result.data.user, false)

  const supportRequest = await request('/api/support/requests', {
    method: 'POST',
    token: anaToken,
    body: JSON.stringify({
      category: 'pagos',
      subject: 'Consulta sobre pago',
      message: 'Mi pago aparece rechazado y quiero saber el motivo.',
    }),
  })
  assert.equal(supportRequest.status, 201)
  assert.equal(supportRequest.data.request.status, 'open')
  const mySupportRequests = await request('/api/support/requests', { token: anaToken })
  assert.equal(mySupportRequests.status, 200)
  assert.equal(mySupportRequests.data.requests[0].id, supportRequest.data.request.id)
  const supportAdminToken = await login('fastbank@gmail.com', 'REMOVED', 'REMOVED')
  const adminSupportRequests = await request('/api/admin/support/requests', { token: supportAdminToken })
  assert.equal(adminSupportRequests.status, 200)
  assert.equal(adminSupportRequests.data.requests[0].email, 'ana@gmail.com')
  const supportReply = await request(`/api/admin/support/requests/${supportRequest.data.request.id}`, {
    method: 'PATCH',
    token: supportAdminToken,
    body: JSON.stringify({ status: 'resolved', response: 'Revisamos el caso. El movimiento fue rechazado por saldo insuficiente.' }),
  })
  assert.equal(supportReply.status, 200)
  assert.equal(supportReply.data.request.status, 'resolved')
  const updatedSupportRequest = await request('/api/support/requests', { token: anaToken })
  assert.equal(updatedSupportRequest.data.requests[0].response, 'Revisamos el caso. El movimiento fue rechazado por saldo insuficiente.')
  const invalidSupportRequest = await request('/api/support/requests', {
    method: 'POST',
    token: anaToken,
    body: JSON.stringify({ category: 'admin', subject: 'Ayuda', message: 'Corto' }),
  })
  assert.equal(invalidSupportRequest.status, 400)

  const transferOptions = {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'transfer-once' },
    body: JSON.stringify({ recipient: 'Fastbank Admin', account: '3018489400', amount: 100000, type: 'third' }),
  }
  result = await request('/api/transfers', transferOptions)
  assert.equal(result.status, 201)
  const transferId = result.data.transaction.id
  assert.equal(result.data.transaction.status, 'Procesado')
  const duplicate = await request('/api/transfers', transferOptions)
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.data.transaction.id, transferId)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE idempotency_key = ?').get('transfer-once').count, 1)

  const transferEntries = db.prepare('SELECT side, amount FROM ledger_entries WHERE transaction_id = ?').all(transferId)
  assert.equal(transferEntries.length, 2)
  assert.equal(transferEntries.filter((entry) => entry.side === 'debit').reduce((sum, entry) => sum + entry.amount, 0), 100000)
  assert.equal(transferEntries.filter((entry) => entry.side === 'credit').reduce((sum, entry) => sum + entry.amount, 0), 100000)

  const idOnlyQrTransfer = await request('/api/transfers', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'qr-userid-only' },
    body: JSON.stringify({ recipient: 'admin-fastbank', account: 'admin-fastbank', recipientId: 'admin-fastbank', amount: 1000 }),
  })
  assert.equal(idOnlyQrTransfer.status, 201)
  assert.equal(idOnlyQrTransfer.data.transaction.status, 'Procesado')
  const accountIdQrTransfer = await request('/api/transfers', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'qr-account-id-only' },
    body: JSON.stringify({ recipient: '', account: 'admin-fastbank', amount: 1000 }),
  })
  assert.equal(accountIdQrTransfer.status, 201)
  assert.equal(accountIdQrTransfer.data.transaction.status, 'Procesado')

  const rejected = await request('/api/transfers', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'insufficient-funds' },
    body: JSON.stringify({ recipient: 'Fastbank Admin', account: '3018489400', amount: 2000000, type: 'third' }),
  })
  assert.equal(rejected.status, 409)
  assert.equal(rejected.data.transaction.status, 'Rechazado')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ledger_entries WHERE transaction_id = ?').get(rejected.data.transaction.id).count, 0)

  const servicePaymentOptions = {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'service-payment-once' },
    body: JSON.stringify({ serviceId: 'mobile-claro', reference: '3001234567', planId: 'claro-3gb-9d', amount: 11000 }),
  }
  const servicePayment = await request('/api/services/payments', servicePaymentOptions)
  assert.equal(servicePayment.status, 201)
  assert.equal(servicePayment.data.transaction.category, 'Pagos y recargas')
  assert.equal(servicePayment.data.summary.account.balance, 887000)
  const duplicateServicePayment = await request('/api/services/payments', servicePaymentOptions)
  assert.equal(duplicateServicePayment.status, 200)
  assert.equal(duplicateServicePayment.data.transaction.id, servicePayment.data.transaction.id)
  const servicePaymentEntries = db.prepare('SELECT side, amount FROM ledger_entries WHERE transaction_id = ?')
    .all(servicePayment.data.transaction.id)
  assert.equal(servicePaymentEntries.length, 2)
  assert.equal(servicePaymentEntries.filter((entry) => entry.side === 'debit').reduce((sum, entry) => sum + entry.amount, 0), 11000)
  assert.equal(servicePaymentEntries.filter((entry) => entry.side === 'credit').reduce((sum, entry) => sum + entry.amount, 0), 11000)

  const mismatchedRechargePlan = await request('/api/services/payments', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'mismatched-recharge-plan' },
    body: JSON.stringify({ serviceId: 'mobile-claro', reference: '3001234567', planId: 'claro-3gb-9d', amount: 50000 }),
  })
  assert.equal(mismatchedRechargePlan.status, 400)
  assert.equal(mismatchedRechargePlan.data.transaction.status, 'Rechazado')

  const invalidMobilePayment = await request('/api/services/payments', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'invalid-mobile-service-payment' },
    body: JSON.stringify({ serviceId: 'mobile-claro', reference: '12345', amount: 25000 }),
  })
  assert.equal(invalidMobilePayment.status, 400)
  assert.equal(invalidMobilePayment.data.transaction.status, 'Rechazado')
  const insufficientServicePayment = await request('/api/services/payments', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'insufficient-service-payment' },
    body: JSON.stringify({ serviceId: 'water-eaab', reference: 'Contrato 1234', amount: 2000000 }),
  })
  assert.equal(insufficientServicePayment.status, 409)
  assert.equal(insufficientServicePayment.data.transaction.status, 'Rechazado')

  const createdPocket = await request('/api/pockets', {
    method: 'POST',
    token: anaToken,
    body: JSON.stringify({ name: 'Emergencias', goal: 500000 }),
  })
  assert.equal(createdPocket.status, 201)
  const pocketId = createdPocket.data.pocket.id
  const deposit = await request(`/api/pockets/${pocketId}`, {
    method: 'PATCH',
    token: anaToken,
    headers: { 'Idempotency-Key': 'pocket-deposit' },
    body: JSON.stringify({ action: 'deposit', amount: 200000 }),
  })
  assert.equal(deposit.status, 201)
  assert.equal(deposit.data.summary.account.balance, 687000)
  assert.equal(deposit.data.summary.pockets[0].balance, 200000)

  const lock = await request(`/api/pockets/${pocketId}/lock`, {
    method: 'PATCH',
    token: anaToken,
    body: JSON.stringify({ locked: true }),
  })
  assert.equal(lock.status, 200)
  const blockedWithdrawal = await request(`/api/pockets/${pocketId}`, {
    method: 'PATCH',
    token: anaToken,
    headers: { 'Idempotency-Key': 'blocked-withdrawal' },
    body: JSON.stringify({ action: 'withdraw', amount: 50000 }),
  })
  assert.equal(blockedWithdrawal.status, 409)
  assert.equal(blockedWithdrawal.data.transaction.status, 'Rechazado')

  await request(`/api/pockets/${pocketId}/lock`, {
    method: 'PATCH',
    token: anaToken,
    body: JSON.stringify({ locked: false }),
  })
  const withdrawal = await request(`/api/pockets/${pocketId}`, {
    method: 'PATCH',
    token: anaToken,
    headers: { 'Idempotency-Key': 'pocket-withdrawal' },
    body: JSON.stringify({ action: 'withdraw', amount: 50000 }),
  })
  assert.equal(withdrawal.status, 201)
  assert.equal(withdrawal.data.summary.account.balance, 737000)

  const assessment = await request('/api/loans/assessment', { token: anaToken })
  assert.equal(assessment.status, 200)
  assert.equal(assessment.data.assessment.eligible, true)
  assert.ok(assessment.data.assessment.averageBalance > 0)
  const loanResult = await request('/api/loans', {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'loan-once' },
    body: JSON.stringify({ amount: 100000, term: 3 }),
  })
  assert.equal(loanResult.status, 201)
  assert.equal(loanResult.data.loan.status, 'active')
  const payment = await request(`/api/loans/${loanResult.data.loan.id}/payments`, {
    method: 'POST',
    token: anaToken,
    headers: { 'Idempotency-Key': 'loan-payment-once' },
    body: JSON.stringify({}),
  })
  assert.equal(payment.status, 201)
  assert.ok(payment.data.payment.remainingBalance < loanResult.data.loan.totalPayable)

  const noCardRequests = await request('/api/cards/requests', { token: anaToken })
  assert.equal(noCardRequests.status, 200)
  assert.equal(noCardRequests.data.requests.length, 0)
  const missingCardSelection = await request('/api/cards', {
    method: 'PATCH',
    token: anaToken,
    body: JSON.stringify({ locked: true }),
  })
  assert.equal(missingCardSelection.status, 400)
  const debitCardRequest = await request('/api/cards/requests', {
    method: 'POST',
    token: anaToken,
    body: JSON.stringify({ cardKinds: ['debit'], cardTypes: ['digital'] }),
  })
  assert.equal(debitCardRequest.status, 201)
  assert.equal(debitCardRequest.data.requests[0].cardStatus, 'active')
  const debitCardLimitChange = await request('/api/cards', {
    method: 'PATCH',
    token: anaToken,
    body: JSON.stringify({ cardRequestId: debitCardRequest.data.requests[0].id, limit: 500000 }),
  })
  assert.equal(debitCardLimitChange.status, 400)
  const debitCards = await request('/api/cards/requests', { token: anaToken })
  assert.equal(debitCards.data.requests.length, 1)
  assert.ok(debitCards.data.requests[0].cardNumber)
  const card = await request('/api/cards', {
    method: 'PATCH',
    token: anaToken,
    body: JSON.stringify({ cardRequestId: debitCardRequest.data.requests[0].id, locked: true }),
  })
  assert.equal(card.status, 200)
  assert.equal(card.data.cardLocked, true)

  const adminToken = await login('fastbank@gmail.com', 'REMOVED', 'REMOVED')
  const reversal = await request(`/api/transactions/${transferId}/reverse`, { method: 'POST', token: adminToken })
  assert.equal(reversal.status, 200)
  assert.equal(reversal.data.transaction.status, 'Procesado')
  assert.equal(db.prepare('SELECT status FROM transactions WHERE id = ?').get(transferId).status, 'Revertido')
  const qrReversal = await request(`/api/transactions/${idOnlyQrTransfer.data.transaction.id}/reverse`, { method: 'POST', token: adminToken })
  assert.equal(qrReversal.status, 200)
  const accountIdQrReversal = await request(`/api/transactions/${accountIdQrTransfer.data.transaction.id}/reverse`, { method: 'POST', token: adminToken })
  assert.equal(accountIdQrReversal.status, 200)
  assert.equal(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('checking-admin-fastbank').balance, 0)

  const finalSummary = await request('/api/banking/summary', { token: anaToken })
  assert.equal(finalSummary.status, 200)
  assert.equal(finalSummary.data.transactions.find((transaction) => transaction.id === transferId).status, 'Revertido')
  assert.equal(finalSummary.data.pockets[0].balance, 150000)

  const unbalancedTransactions = db.prepare(`
    SELECT transaction_id
    FROM ledger_entries
    GROUP BY transaction_id
    HAVING COUNT(*) < 2
      OR SUM(CASE WHEN side = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN side = 'credit' THEN amount ELSE 0 END)
  `).all()
  assert.deepEqual(unbalancedTransactions, [])

  const underageRegistrationCode = await request('/api/auth/register/email-code', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000001',
      phone: '3007000001',
      email: 'new-account@fastbank.test',
      birthDate: '2010-01-01',
    }),
  })
  assert.equal(underageRegistrationCode.status, 400)

  const incompleteRegistrationCode = await request('/api/auth/register/email-code', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '12345',
      phone: '300123456',
      email: 'incomplete-account@fastbank.test',
      birthDate: '1990-01-01',
    }),
  })
  assert.equal(incompleteRegistrationCode.status, 400)
  assert.match(incompleteRegistrationCode.data.message, /cédula le faltan 1 número/)

  const incompleteRegistrationPhone = await request('/api/auth/register/email-code', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '123456',
      phone: '300123456',
      email: 'incomplete-phone@fastbank.test',
      birthDate: '1990-01-01',
    }),
  })
  assert.equal(incompleteRegistrationPhone.status, 400)
  assert.match(incompleteRegistrationPhone.data.message, /celular le faltan 1 número/)

  const overlongRegistrationNumbers = await request('/api/auth/register/email-code', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '12345678901',
      phone: '3001234567',
      email: 'overlong-account@fastbank.test',
      birthDate: '1990-01-01',
    }),
  })
  assert.equal(overlongRegistrationNumbers.status, 400)
  assert.match(overlongRegistrationNumbers.data.message, /cédula no puede superar 10 números/)

  const invalidRegistrationPhone = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000002',
      phone: '30012345678',
      email: 'invalid-phone@fastbank.test',
      birthDate: '1990-01-01',
      password: 'abcd',
      pin: '2222',
      registrationToken: 'unused-token',
      documentImage: 'data:image/jpeg;base64,/9j/',
    }),
  })
  assert.equal(invalidRegistrationPhone.status, 400)
  assert.match(invalidRegistrationPhone.data.message, /celular debe tener 10 números/)

  const smtpSettings = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
  }
  Object.assign(process.env, {
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
  })
  const today = new Date()
  const eighteenthBirthday = new Date(Date.UTC(
    today.getUTCFullYear() - 18,
    today.getUTCMonth(),
    today.getUTCDate(),
  )).toISOString().slice(0, 10)
  const eligibleRegistrationCode = await request('/api/auth/register/email-code', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000004',
      phone: '3007000004',
      email: 'adult-account@fastbank.test',
      birthDate: eighteenthBirthday,
    }),
  })
  assert.equal(eligibleRegistrationCode.status, 503)
  Object.assign(process.env, smtpSettings)

  const missingVerification = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000001',
      phone: '3007000001',
      email: 'new-account@fastbank.test',
      birthDate: '1990-01-01',
      password: 'abcd',
      pin: '2222',
      documentImage: 'data:image/jpeg;base64,/9j/',
    }),
  })
  assert.equal(missingVerification.status, 400)

  const verifiedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO email_verifications (email, code_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(
    'new-account@fastbank.test',
    createHash('sha256').update('01234').digest('hex'),
    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    verifiedAt,
  )
  const shortVerificationCode = await request('/api/auth/register/email-code/verify', {
    method: 'POST',
    body: JSON.stringify({ email: 'new-account@fastbank.test', code: '1234' }),
  })
  assert.equal(shortVerificationCode.status, 400)
  const emailVerification = await request('/api/auth/register/email-code/verify', {
    method: 'POST',
    body: JSON.stringify({ email: 'new-account@fastbank.test', code: '01234' }),
  })
  assert.equal(emailVerification.status, 200)
  const registrationToken = emailVerification.data.registrationToken
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000001',
      phone: '3007000001',
      email: 'new-account@fastbank.test',
      birthDate: '1990-01-01',
      password: 'abcd',
      pin: '2222',
      registrationToken,
      documentImage: 'data:image/jpeg;base64,/9j/',
    }),
  })
  assert.equal(registration.status, 201)
  const newAccount = await request('/api/banking/summary', { token: registration.data.token })
  assert.equal(newAccount.data.account.balance, 0)
  assert.equal(newAccount.data.user.trustScore, 60)
  assert.equal(newAccount.data.creditAssessment.eligible, true)
  assert.equal(newAccount.data.creditAssessment.level, 'Base')
  assert.equal(newAccount.data.creditAssessment.limit, 100000)
  assert.equal(registration.data.user.cardNumber, null)
  assert.equal(db.prepare('SELECT card_number, cvv FROM users WHERE id = ?').get(registration.data.user.id).card_number, null)
  assert.equal(db.prepare('SELECT cvv FROM users WHERE id = ?').get(registration.data.user.id).cvv, null)
  assert.equal(db.prepare('SELECT used_at FROM email_verifications WHERE email = ?').get('new-account@fastbank.test').used_at !== null, true)
  const unauthenticatedCardRequests = await request('/api/cards/requests')
  assert.equal(unauthenticatedCardRequests.status, 401)
  const missingCardDeliveryAddress = await request('/api/cards/requests', {
    method: 'POST',
    token: registration.data.token,
    body: JSON.stringify({ cardKinds: ['debit'], cardTypes: ['physical'] }),
  })
  assert.equal(missingCardDeliveryAddress.status, 400)
  const cardRequest = await request('/api/cards/requests', {
    method: 'POST',
    token: registration.data.token,
    body: JSON.stringify({
      cardKinds: ['debit'],
      cardTypes: ['physical'],
      address: 'Carrera 10 # 20-30, apartamento 402',
      city: 'Bogotá',
      department: 'Cundinamarca',
      postalCode: '110111',
      firstName: 'Nombre manipulado',
      email: 'otro-correo@fastbank.test',
    }),
  })
  assert.equal(cardRequest.status, 201)
  assert.equal(cardRequest.data.requests[0].status, 'pending')
  assert.equal(cardRequest.data.requests[0].cardStatus, 'pending')
  assert.match(cardRequest.data.message, /aproximadamente 7 días/)
  assert.match(cardRequest.data.message, /Carrera 10 # 20-30/)
  const savedCardRequests = await request('/api/cards/requests', { token: registration.data.token })
  assert.equal(savedCardRequests.status, 200)
  assert.equal(savedCardRequests.data.requests.length, 1)
  assert.equal(savedCardRequests.data.requests[0].firstName, 'Cuenta')
  assert.equal(savedCardRequests.data.requests[0].lastName, 'Nueva')
  assert.equal(savedCardRequests.data.requests[0].document, '7000000001')
  assert.equal(savedCardRequests.data.requests[0].phone, '3007000001')
  assert.equal(savedCardRequests.data.requests[0].email, 'new-account@fastbank.test')
  assert.equal(savedCardRequests.data.requests[0].address, 'Carrera 10 # 20-30, apartamento 402')
  assert.equal(savedCardRequests.data.requests[0].cardNumber, null)
  const duplicatePhysicalRequest = await request('/api/cards/requests', {
    method: 'POST',
    token: registration.data.token,
    body: JSON.stringify({
      cardKinds: ['debit'],
      cardTypes: ['physical'],
      address: 'Otra dirección',
      city: 'Bogotá',
      department: 'Cundinamarca',
    }),
  })
  assert.equal(duplicatePhysicalRequest.status, 200)
  assert.equal(duplicatePhysicalRequest.data.requests.length, 0)
  assert.match(duplicatePhysicalRequest.data.message, /Ya tienes solicitadas/)
  const virtualCreditRequest = await request('/api/cards/requests', {
    method: 'POST',
    token: registration.data.token,
    body: JSON.stringify({ cardKinds: ['credit'], cardTypes: ['digital'] }),
  })
  assert.equal(virtualCreditRequest.status, 201)
  assert.equal(virtualCreditRequest.data.requests[0].cardStatus, 'active')
  assert.match(virtualCreditRequest.data.message, /activa inmediatamente/)
  assert.match(virtualCreditRequest.data.message, /para usar en Fastbank/)
  assert.equal(virtualCreditRequest.data.requests[0].cardLimit, 1500000)
  const creditLimitChange = await request('/api/cards', {
    method: 'PATCH',
    token: registration.data.token,
    body: JSON.stringify({ cardRequestId: virtualCreditRequest.data.requests[0].id, limit: 250000 }),
  })
  assert.equal(creditLimitChange.status, 200)
  assert.equal(creditLimitChange.data.cardLimit, 250000)
  const simultaneousCardRequest = await request('/api/cards/requests', {
    method: 'POST',
    token: registration.data.token,
    body: JSON.stringify({
      cardKinds: ['debit', 'credit'],
      cardTypes: ['physical', 'digital'],
      address: 'Carrera 10 # 20-30, apartamento 402',
      city: 'Bogotá',
      department: 'Cundinamarca',
      postalCode: '110111',
    }),
  })
  assert.equal(simultaneousCardRequest.status, 201)
  assert.equal(simultaneousCardRequest.data.requests.length, 2)
  assert.match(simultaneousCardRequest.data.message, /Se omitieron opciones/)
  assert.deepEqual(
    simultaneousCardRequest.data.requests.map(({ cardKind, cardType }) => [cardKind, cardType]).sort(),
    [['credit', 'physical'], ['debit', 'digital']],
  )
  assert.equal(simultaneousCardRequest.data.requests.find((item) => item.cardKind === 'credit').cardLimit, 1500000)
  const invalidCardRequest = await request('/api/cards/requests', {
    method: 'POST',
    token: registration.data.token,
    body: JSON.stringify({ cardKinds: ['debit'], cardTypes: ['premium'] }),
  })
  assert.equal(invalidCardRequest.status, 400)
  const cardCvv = await request(`/api/cards/requests/${virtualCreditRequest.data.requests[0].id}/cvv`, { token: registration.data.token })
  assert.equal(cardCvv.status, 200)
  assert.match(cardCvv.data.cvv, /^\d{3}$/)
  const unauthenticatedCardCvv = await request(`/api/cards/requests/${virtualCreditRequest.data.requests[0].id}/cvv`)
  assert.equal(unauthenticatedCardCvv.status, 401)
  const savedAfterVirtualRequest = await request('/api/cards/requests', { token: registration.data.token })
  assert.equal(savedAfterVirtualRequest.data.requests.length, 4)
  assert.ok(savedAfterVirtualRequest.data.requests.find((item) => item.cardKind === 'credit' && item.cardType === 'digital').cardNumber)
  const pendingPhysicalCvv = await request(`/api/cards/requests/${cardRequest.data.requests[0].id}/cvv`, { token: registration.data.token })
  assert.equal(pendingPhysicalCvv.status, 404)
  db.prepare("UPDATE card_requests SET estimated_ready_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), cardRequest.data.requests[0].id)
  const readyPhysicalCards = await request('/api/cards/requests', { token: registration.data.token })
  const readyPhysicalCard = readyPhysicalCards.data.requests.find((item) => item.id === cardRequest.data.requests[0].id)
  assert.equal(readyPhysicalCard.cardStatus, 'active')
  assert.ok(readyPhysicalCard.cardNumber)

  const newCustomerToken = registration.data.token
  const newCustomerId = registration.data.user.id
  const newCustomerPhone = '3007000001'
  const initialLoanMinimum = await request('/api/loans', {
    method: 'POST',
    token: newCustomerToken,
    body: JSON.stringify({ amount: 99999, term: 3 }),
  })
  assert.equal(initialLoanMinimum.status, 400)

  const repayLoanOnTime = async ({ amount, expectedScore, expectedLimit, suffix }) => {
    const loan = await request('/api/loans', {
      method: 'POST',
      token: newCustomerToken,
      headers: { 'Idempotency-Key': `new-user-loan-${suffix}` },
      body: JSON.stringify({ amount, term: 3 }),
    })
    assert.equal(loan.status, 201)

    const interest = loan.data.loan.totalPayable - amount
    if (interest > 0) {
      const topUp = await request('/api/transfers', {
        method: 'POST',
        token: anaToken,
        headers: { 'Idempotency-Key': `new-user-top-up-${suffix}` },
        body: JSON.stringify({
          recipient: 'Cuenta Nueva',
          account: newCustomerPhone,
          recipientId: newCustomerId,
          amount: interest,
        }),
      })
      assert.equal(topUp.status, 201, JSON.stringify(topUp.data))
    }

    const payment = await request(`/api/loans/${loan.data.loan.id}/payments`, {
      method: 'POST',
      token: newCustomerToken,
      headers: { 'Idempotency-Key': `new-user-loan-payment-${suffix}` },
      body: JSON.stringify({ amount: loan.data.loan.totalPayable }),
    })
    assert.equal(payment.status, 201, JSON.stringify(payment.data))
    assert.equal(payment.data.payment.scoreIncrease, 10)
    assert.equal(payment.data.summary.user.trustScore, expectedScore)
    assert.equal(payment.data.summary.creditAssessment.limit, expectedLimit)
    return payment.data.summary
  }

  const escalatedAccount = await repayLoanOnTime({
    amount: 100000,
    expectedScore: 70,
    expectedLimit: 200000,
    suffix: 'base',
  })
  assert.equal(escalatedAccount.creditAssessment.level, 'Escalada')

  const advancedAccount = await repayLoanOnTime({
    amount: 200000,
    expectedScore: 80,
    expectedLimit: 500000,
    suffix: 'escalada',
  })
  assert.equal(advancedAccount.creditAssessment.level, 'Avanzado')

  const premiumAccount = await repayLoanOnTime({
    amount: 500000,
    expectedScore: 90,
    expectedLimit: 1500000,
    suffix: 'avanzado',
  })
  assert.equal(premiumAccount.creditAssessment.level, 'Premium')

  const overProgramMaximum = await request('/api/loans', {
    method: 'POST',
    token: newCustomerToken,
    body: JSON.stringify({ amount: 1500001, term: 3 }),
  })
  assert.equal(overProgramMaximum.status, 403)
  assert.equal(overProgramMaximum.data.assessment.limit, 1500000)

  const maximumLoan = await request('/api/loans', {
    method: 'POST',
    token: newCustomerToken,
    headers: { 'Idempotency-Key': 'new-user-premium-loan' },
    body: JSON.stringify({ amount: 1500000, term: 3 }),
  })
  assert.equal(maximumLoan.status, 201)

  const reusedRegistrationToken = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000002',
      phone: '3007000002',
      email: 'another-account@fastbank.test',
      birthDate: '1990-01-01',
      password: 'abcd',
      pin: '2222',
      registrationToken,
      documentImage: 'data:image/jpeg;base64,/9j/',
    }),
  })
  assert.equal(reusedRegistrationToken.status, 400)

  const malformedImageRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Cuenta',
      lastName: 'Nueva',
      document: '7000000003',
      phone: '3007000003',
      email: 'new-account@fastbank.test',
      birthDate: '1990-01-01',
      password: 'abcd',
      pin: '2222',
      registrationToken,
      documentImage: 'data:image/jpeg;base64,YWJj',
    }),
  })
  assert.equal(malformedImageRegistration.status, 400)
})

test('admin password reset uses a one-time hashed code and invalidates previous sessions', async () => {
  const oldUserSession = await login('ana@gmail.com', 'REMOVED', 'REMOVED')
  const adminToken = await login('fastbank@gmail.com', 'REMOVED', 'REMOVED')
  const originalPinHash = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get('demo-user-fastbank').pin_hash

  const unauthenticatedIssue = await request('/api/admin/users/demo-user-fastbank/password-reset', {
    method: 'POST',
  })
  assert.equal(unauthenticatedIssue.status, 401)

  const emailUnavailable = await request('/api/admin/users/demo-user-fastbank/password-reset', {
    method: 'POST',
    token: adminToken,
  })
  assert.equal(emailUnavailable.status, 503)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get().count, 0)

  const token = '59381'
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'demo-user-fastbank',
    createHash('sha256').update(token).digest('hex'),
    expiresAt,
    'admin-fastbank',
    new Date().toISOString(),
  )
  const storedToken = db.prepare('SELECT token_hash, expires_at FROM password_reset_tokens WHERE user_id = ?')
    .get('demo-user-fastbank')
  assert.notEqual(storedToken.token_hash, token)
  assert.ok(Date.parse(storedToken.expires_at) > Date.now())

  const rejectedWeakPassword = await request('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@gmail.com', token, password: 'abc' }),
  })
  assert.equal(rejectedWeakPassword.status, 400)

  const reset = await request('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({
      email: 'ana@gmail.com',
      token,
      password: 'abcd',
    }),
  })
  assert.equal(reset.status, 200)
  assert.equal(db.prepare('SELECT pin_hash FROM users WHERE id = ?').get('demo-user-fastbank').pin_hash, originalPinHash)

  const reusedToken = await request('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({
      email: 'ana@gmail.com',
      token,
      password: 'AnotherSafePass789',
    }),
  })
  assert.equal(reusedToken.status, 400)

  const oldPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'ana@gmail.com', password: 'REMOVED', pin: 'REMOVED' }),
  })
  assert.equal(oldPasswordLogin.status, 401)

  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'ana@gmail.com', password: 'abcd', pin: 'REMOVED' }),
  })
  assert.equal(newPasswordLogin.status, 200)

  const invalidatedSession = await request('/api/profile', { token: oldUserSession })
  assert.equal(invalidatedSession.status, 401)

  const expiringCode = '41920'
  db.prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), 'demo-user-fastbank')
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'demo-user-fastbank',
    createHash('sha256').update(expiringCode).digest('hex'),
    new Date(Date.now() - 1000).toISOString(),
    'admin-fastbank',
    new Date().toISOString(),
  )
  const expiredCodeReset = await request('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({
      email: 'ana@gmail.com',
      token: expiringCode,
      password: 'ExpiredCodePass123',
    }),
  })
  assert.equal(expiredCodeReset.status, 400)
})

test('email PIN reset validates four digits, consumes only PIN codes, and invalidates old sessions', async () => {
  const oldUserSession = await login('ana@gmail.com', 'abcd', 'REMOVED')
  const token = '20486'
  const timestamp = new Date().toISOString()
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, expires_at, created_by, created_at)
    VALUES (?, ?, ?, 'pin', ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'demo-user-fastbank',
    createHash('sha256').update(token).digest('hex'),
    new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    'demo-user-fastbank',
    timestamp,
  )

  const shortPin = await request('/api/auth/pin-reset', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@gmail.com', token, pin: '123' }),
  })
  assert.equal(shortPin.status, 400)

  const nonNumericPin = await request('/api/auth/pin-reset', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@gmail.com', token, pin: '12a4' }),
  })
  assert.equal(nonNumericPin.status, 400)

  const wrongCredentialPurpose = await request('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@gmail.com', token, password: 'abcd' }),
  })
  assert.equal(wrongCredentialPurpose.status, 400)

  const reset = await request('/api/auth/pin-reset', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@gmail.com', token, pin: '2468' }),
  })
  assert.equal(reset.status, 200)

  const oldPinLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'ana@gmail.com', password: 'abcd', pin: 'REMOVED' }),
  })
  assert.equal(oldPinLogin.status, 401)

  const newPinLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'ana@gmail.com', password: 'abcd', pin: '2468' }),
  })
  assert.equal(newPinLogin.status, 200)

  const invalidatedSession = await request('/api/profile', { token: oldUserSession })
  assert.equal(invalidatedSession.status, 401)
})
