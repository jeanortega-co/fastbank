import { rechargePlanById, serviceById } from '../src/data/serviceCatalog.js'
import { registerAviatorService } from './services/aviator.js'

const now = () => new Date().toISOString()
const money = (value) => Number.isSafeInteger(value) && value > 0
const normalizeAccount = (value) => String(value || '').replace(/\D/g, '')
const formatCurrency = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
const marketStartDay = '2026-01-01'
const investmentTerms = new Set([7, 30, 90, 180])
const investmentAssets = [
  { symbol: 'AAPL', name: 'Apple', sector: 'Tecnología', basePrice: 920000, volatility: 0.016 },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Semiconductores', basePrice: 1380000, volatility: 0.026 },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Tecnología', basePrice: 1720000, volatility: 0.014 },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Comercio y tecnología', basePrice: 1040000, volatility: 0.019 },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Automotriz', basePrice: 1160000, volatility: 0.03 },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Tecnología y medios', basePrice: 830000, volatility: 0.017 },
]
const marketTickMilliseconds = 3000
const dayOffset = (day) => Math.floor((Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${marketStartDay}T00:00:00.000Z`)) / 86400000)
const dailyChange = (symbol, offset, volatility) => {
  let hash = 2166136261
  const seed = `${symbol}:${offset}`
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  const movement = ((hash >>> 0) / 0xffffffff - 0.5) * volatility
  return movement + 0.00015
}
const marketPriceOnDay = (asset, day) => {
  const offset = dayOffset(day)
  let price = asset.basePrice
  for (let index = 0; index <= Math.max(0, offset); index += 1) {
    price = Math.max(1, Math.round(price * (1 + dailyChange(asset.symbol, index, asset.volatility))))
  }
  return price
}
const assetPhase = (symbol) => {
  let hash = 2166136261
  for (let index = 0; index < symbol.length; index += 1) hash = Math.imul(hash ^ symbol.charCodeAt(index), 16777619)
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2
}
const marketPriceOnTick = (asset, tick) => {
  const tickTime = new Date(tick * marketTickMilliseconds)
  const day = tickTime.toISOString().slice(0, 10)
  const phase = assetPhase(asset.symbol)
  const movement = Math.sin(tick * 0.31 + phase) * 0.012
    + Math.sin(tick * 0.089 + phase * 1.7) * 0.006
  return Math.max(1, Math.round(marketPriceOnDay(asset, day) * (1 + movement)))
}
const investmentAssetBySymbol = (symbol) => investmentAssets.find((asset) => asset.symbol === symbol)
const marketQuote = (asset, timestamp = Date.now()) => {
  const currentTick = Math.floor(timestamp / marketTickMilliseconds)
  const currentPrice = marketPriceOnTick(asset, currentTick)
  const previousPrice = marketPriceOnTick(asset, currentTick - 1)
  const liveCandles = Array.from({ length: 30 }, (_, index) => {
    const tick = currentTick - 29 + index
    const open = marketPriceOnTick(asset, tick - 1)
    const close = marketPriceOnTick(asset, tick)
    const wick = Math.max(1, Math.round(close * Math.min(asset.volatility * 0.12, 0.004)))
    return {
      id: tick,
      open,
      close,
      high: Math.max(open, close) + wick,
      low: Math.max(1, Math.min(open, close) - wick),
    }
  })
  const history = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(timestamp)
    day.setUTCDate(day.getUTCDate() - (29 - index))
    return { date: day.toISOString().slice(0, 10), price: marketPriceOnDay(asset, day.toISOString().slice(0, 10)) }
  })
  history[history.length - 1].price = currentPrice
  return {
    symbol: asset.symbol,
    name: asset.name,
    sector: asset.sector,
    price: currentPrice,
    change: Number((((currentPrice - previousPrice) / previousPrice) * 100).toFixed(2)),
    history,
    liveCandles,
    updatedAt: new Date(currentTick * marketTickMilliseconds).toISOString(),
  }
}

class BankingError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const registerBankingRoutes = ({ app, db, audit, publicUser, requireAuth, requireAdmin }) => {
  const checkingAccount = (userId) => db.prepare("SELECT * FROM accounts WHERE user_id = ? AND kind = 'checking'").get(userId)
  const transactionByIdempotency = (userId, key) => key && db.prepare('SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?').get(userId, key)
  const idempotencyKey = (req, body) => {
    const key = String(req.get('Idempotency-Key') || body?.idempotencyKey || '').trim()
    return key.length > 0 && key.length <= 128 ? key : null
  }

  const transactionView = (row, viewerId) => ({
    id: row.id,
    type: row.counterparty_user_id === viewerId && row.user_id !== viewerId ? 'income' : row.type,
    amount: row.amount,
    description: row.description,
    category: row.category,
    status: row.status,
    date: row.created_at,
  })

  const writeRejected = ({ userId, amount, type, description, category, accountId, key }) => {
    const prior = transactionByIdempotency(userId, key)
    if (prior) return prior

    const row = {
      id: crypto.randomUUID(),
      userId,
      amount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
      type,
      description,
      category,
      accountId: accountId || null,
      createdAt: now(),
    }
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, idempotency_key)
      VALUES (@id, @userId, @type, @amount, @description, @category, 'Rechazado', @createdAt, @accountId, @key)
    `).run({ ...row, key })
    audit(userId, 'banking.transaction.rejected', { transactionId: row.id, type, reason: description })
    return { ...row, user_id: userId, counterparty_user_id: null, created_at: row.createdAt, status: 'Rechazado' }
  }

  const postEntry = (transactionId, accountId, side, amount, createdAt) => {
    const account = db.prepare('SELECT id, kind, balance FROM accounts WHERE id = ?').get(accountId)
    if (!account) throw new BankingError('La cuenta contable no está disponible.', 409)
    const normalSide = account.id === 'system-interest-income' || account.id === 'system-service-clearing' || account.id === 'casino-house'
      ? 'credit'
      : account.kind === 'checking' || account.kind === 'pocket' ? 'credit' : 'debit'
    const delta = side === normalSide ? amount : -amount
    if (account.balance + delta < 0) throw new BankingError('No tienes saldo suficiente para completar la operación.', 409)

    db.prepare(`
      INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), transactionId, accountId, side, amount, createdAt)
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(delta, accountId)
  }

  const createMovement = ({ userId, counterpartyUserId = null, amount, type, description, category, accountId, counterpartyAccountId, key, entries }) => {
    const createdAt = now()
    const transactionId = crypto.randomUUID()
    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO transactions (id, user_id, counterparty_user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?)
      `).run(transactionId, userId, counterpartyUserId, type, amount, description, category, createdAt, accountId, counterpartyAccountId, key)
      for (const entry of entries) postEntry(transactionId, entry.accountId, entry.side, entry.amount ?? amount, createdAt)
      db.prepare("UPDATE transactions SET status = 'Procesado' WHERE id = ?").run(transactionId)
      audit(userId, 'banking.transaction.processed', { transactionId, type, amount, category })
      return db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId)
    })
    return run()
  }

  const createCasinoMovement = ({ userId, amount, type, description, accountId, counterpartyAccountId, key, entries }) => {
    const run = db.transaction(() => {
      const prior = transactionByIdempotency(userId, key)
      if (prior) return prior

      const transactionId = crypto.randomUUID()
      const createdAt = now()
      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, idempotency_key)
        VALUES (?, ?, ?, ?, ?, 'Casino', 'Pendiente', ?, ?, ?, ?)
      `).run(transactionId, userId, type, amount, description, createdAt, accountId, counterpartyAccountId, key)
      for (const entry of entries) postEntry(transactionId, entry.accountId, entry.side, entry.amount ?? amount, createdAt)
      db.prepare("UPDATE transactions SET status = 'Procesado' WHERE id = ?").run(transactionId)
      audit(userId, 'banking.transaction.processed', { transactionId, type, amount, category: 'Casino' })
      return db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId)
    })
    return run()
  }

  const customerAccounts = (userId) => db.prepare("SELECT * FROM accounts WHERE user_id = ? AND kind IN ('checking', 'pocket') ORDER BY created_at").all(userId)

  const creditLevelForScore = (score) => {
    if (score >= 90) return { level: 'Premium', limit: 1500000, nextLevel: null, nextScore: null }
    if (score >= 80) return { level: 'Avanzado', limit: 500000, nextLevel: 'Premium', nextScore: 90 }
    if (score >= 70) return { level: 'Escalada', limit: 200000, nextLevel: 'Avanzado', nextScore: 80 }
    return { level: 'Base', limit: 100000, nextLevel: 'Escalada', nextScore: 70 }
  }

  const creditAssessment = (userId) => {
    const user = db.prepare('SELECT created_at, trust_score FROM users WHERE id = ?').get(userId)
    const accounts = customerAccounts(userId)
    const currentBalance = accounts.reduce((sum, account) => sum + account.balance, 0)
    const nowMs = Date.now()
    const createdMs = Date.parse(user?.created_at || new Date(nowMs - 90 * 86400000).toISOString())
    const windowStartMs = Math.max(nowMs - 90 * 86400000, Number.isFinite(createdMs) ? createdMs : nowMs - 90 * 86400000)
    const windowStart = new Date(windowStartMs).toISOString()
    const durationMs = Math.max(1000, nowMs - windowStartMs)
    const accountIds = accounts.map((account) => account.id)
    let balanceAtStart = currentBalance
    let weightedBalanceMs = 0
    let cursor = windowStartMs

    const entries = accountIds.length
      ? db.prepare(`
          SELECT le.account_id AS accountId, le.side, le.amount, le.created_at AS createdAt, a.kind
          FROM ledger_entries le JOIN accounts a ON a.id = le.account_id
          WHERE le.account_id IN (${accountIds.map(() => '?').join(',')}) AND le.created_at >= ?
          ORDER BY le.created_at, le.id
        `).all(...accountIds, windowStart)
      : []

    const changes = entries.map((entry) => ({
      ...entry,
      time: Date.parse(entry.createdAt),
      delta: entry.kind === 'checking' || entry.kind === 'pocket'
        ? (entry.side === 'credit' ? entry.amount : -entry.amount)
        : 0,
    }))
    balanceAtStart -= changes.reduce((sum, entry) => sum + entry.delta, 0)
    let runningBalance = Math.max(0, balanceAtStart)
    for (const entry of changes) {
      const eventTime = Math.max(cursor, Math.min(nowMs, entry.time))
      weightedBalanceMs += runningBalance * (eventTime - cursor)
      cursor = eventTime
      runningBalance = Math.max(0, runningBalance + entry.delta)
    }
    weightedBalanceMs += runningBalance * (nowMs - cursor)
    const averageBalance = Math.floor(weightedBalanceMs / durationMs)

    const checking = checkingAccount(userId)
    const activity = checking
      ? db.prepare(`
          SELECT COUNT(DISTINCT transaction_id) AS count,
            COALESCE(SUM(CASE WHEN side = 'credit' THEN amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN side = 'debit' THEN amount ELSE 0 END), 0) AS outflow
          FROM ledger_entries WHERE account_id = ? AND created_at >= ?
        `).get(checking.id, windowStart)
      : { count: 0, inflow: 0, outflow: 0 }
    const windowDays = Math.max(1, Math.ceil(durationMs / 86400000))
    const monthlyInflow = Math.floor(activity.inflow * 30 / Math.max(30, windowDays))
    const trustScore = user?.trust_score ?? 60
    const creditLevel = creditLevelForScore(trustScore)

    return {
      trustScore,
      level: creditLevel.level,
      nextLevel: creditLevel.nextLevel,
      nextScore: creditLevel.nextScore,
      averageBalance,
      currentBalance,
      transactionCount: activity.count,
      monthlyInflow,
      monthlyOutflow: Math.floor(activity.outflow * 30 / windowDays),
      windowDays,
      eligible: true,
      limit: creditLevel.limit,
    }
  }

  const investmentData = (userId) => {
    const timestamp = Date.now()
    const instruments = investmentAssets.map((asset) => marketQuote(asset, timestamp))
    const instrumentMap = new Map(instruments.map((instrument) => [instrument.symbol, instrument]))
    const rows = db.prepare(`
      SELECT * FROM investment_positions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(userId)
    const positions = rows.map((row) => {
      const asset = investmentAssetBySymbol(row.symbol)
      const quote = instrumentMap.get(row.symbol)
      const currentPrice = row.status === 'closed'
        ? marketPriceOnDay(asset, row.matures_at.slice(0, 10))
        : quote.price
      const currentValue = row.status === 'closed'
        ? row.payout
        : Math.round(row.shares_scaled * currentPrice / 1000000000)
      return {
        id: row.id,
        symbol: row.symbol,
        name: asset.name,
        amount: row.amount,
        shares: row.shares_scaled / 1000000000,
        purchasePrice: row.purchase_price,
        currentPrice,
        currentValue,
        profitLoss: currentValue - row.amount,
        changePercent: Number((((currentValue - row.amount) / row.amount) * 100).toFixed(2)),
        termDays: row.term_days,
        maturesAt: row.matures_at,
        status: row.status,
        canWithdraw: row.status === 'active' && Date.parse(row.matures_at) <= Date.now(),
        createdAt: row.created_at,
        closedAt: row.closed_at,
        payout: row.payout,
      }
    })
    const portfolioValue = positions
      .filter((position) => position.status === 'active')
      .reduce((sum, position) => sum + position.currentValue, 0)
    return { instruments, positions, portfolioValue }
  }

  const getSummary = (userId) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    const checking = checkingAccount(userId)
    const pockets = db.prepare("SELECT id, name, goal, balance, locked FROM accounts WHERE user_id = ? AND kind = 'pocket' ORDER BY created_at").all(userId)
      .map((pocket) => ({ ...pocket, locked: Boolean(pocket.locked) }))
    const transactions = db.prepare(`
      SELECT * FROM transactions
      WHERE user_id = ? OR counterparty_user_id = ?
      ORDER BY created_at DESC LIMIT 100
    `).all(userId, userId).map((row) => transactionView(row, userId))
    const loans = db.prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC').all(userId)
      .map((loan) => ({
        ...loan,
        paymentHistory: db.prepare('SELECT id, amount, created_at AS date FROM loan_payments WHERE loan_id = ? ORDER BY created_at DESC').all(loan.id),
      }))
    const assessment = creditAssessment(userId)
    const investments = investmentData(userId)

    return {
      user: publicUser(user),
      account: { balance: checking?.balance || 0, savings: pockets.reduce((sum, pocket) => sum + pocket.balance, 0), totalBalance: (checking?.balance || 0) + pockets.reduce((sum, pocket) => sum + pocket.balance, 0) },
      investmentValue: investments.portfolioValue,
      pockets,
      loans,
      transactions,
      creditAssessment: assessment,
    }
  }

  app.get('/api/banking/summary', requireAuth, (req, res) => res.json(getSummary(req.user.id)))

  app.get('/api/investments', requireAuth, (req, res) => {
    res.json({ ...investmentData(req.user.id), availableBalance: checkingAccount(req.user.id)?.balance || 0 })
  })

  app.post('/api/investments', requireAuth, (req, res) => {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase()
    const amount = Number(req.body?.amount)
    const termDays = Number(req.body?.termDays)
    const asset = investmentAssetBySymbol(symbol)
    const source = checkingAccount(req.user.id)
    const key = idempotencyKey(req, req.body)
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) {
      const position = db.prepare('SELECT id FROM investment_positions WHERE purchase_transaction_id = ?').get(prior.id)
      if (position) return res.json({ summary: getSummary(req.user.id), investments: investmentData(req.user.id) })
      return res.status(409).json({ message: 'Esta solicitud ya fue utilizada para otra operación.' })
    }
    if (!asset) return res.status(400).json({ message: 'Selecciona una acción disponible.' })
    if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 100000000) {
      return res.status(400).json({ message: 'Ingresa un monto entre $10.000 y $100.000.000 COP.' })
    }
    if (!investmentTerms.has(termDays)) return res.status(400).json({ message: 'Selecciona un plazo disponible.' })
    if (!source) return res.status(409).json({ message: 'No hay una cuenta principal disponible.' })
    if (source.balance < amount) return res.status(409).json({ message: 'El saldo disponible no alcanza para esta inversión.' })

    const quote = marketQuote(asset)
    const sharesScaled = Math.round(amount * 1000000000 / quote.price)
    if (sharesScaled < 1) return res.status(400).json({ message: 'El monto es demasiado bajo para adquirir una fracción de esta acción.' })
    const createdAt = now()
    const maturesAt = new Date(Date.parse(createdAt) + termDays * 86400000).toISOString()
    const positionId = crypto.randomUUID()
    const transactionId = crypto.randomUUID()
    const holdings = db.prepare("SELECT id FROM accounts WHERE id = 'system-investment-holdings'").get()

    const createInvestment = db.transaction(() => {
      const currentSource = checkingAccount(req.user.id)
      if (!currentSource || currentSource.balance < amount) throw new BankingError('El saldo disponible cambió. Actualiza la pantalla e inténtalo de nuevo.', 409)
      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, idempotency_key)
        VALUES (?, ?, 'investment', ?, ?, 'Inversiones', 'Procesado', ?, ?, ?, ?)
      `).run(transactionId, req.user.id, amount, `Inversión en ${asset.name} (${symbol})`, createdAt, currentSource.id, holdings.id, key)
      db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(amount, currentSource.id)
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(amount, holdings.id)
      db.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
        VALUES (?, ?, ?, 'debit', ?, ?), (?, ?, ?, 'credit', ?, ?)
      `).run(crypto.randomUUID(), transactionId, currentSource.id, amount, createdAt, crypto.randomUUID(), transactionId, holdings.id, amount, createdAt)
      db.prepare(`
        INSERT INTO investment_positions (
          id, user_id, symbol, amount, shares_scaled, purchase_price, term_days,
          matures_at, purchase_transaction_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(positionId, req.user.id, symbol, amount, sharesScaled, quote.price, termDays, maturesAt, transactionId, createdAt)
      audit(req.user.id, 'banking.investment.opened', { positionId, symbol, amount, termDays })
    })

    try {
      createInvestment()
      return res.status(201).json({ summary: getSummary(req.user.id), investments: investmentData(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return res.status(error.status).json({ message: error.message })
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && key) return res.status(409).json({ message: 'Esta solicitud ya fue procesada.' })
      throw error
    }
  })

  app.post('/api/investments/:investmentId/withdraw', requireAuth, (req, res) => {
    const key = idempotencyKey(req, req.body)
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) {
      const closedPosition = db.prepare('SELECT id FROM investment_positions WHERE close_transaction_id = ?').get(prior.id)
      if (closedPosition) return res.json({ summary: getSummary(req.user.id), investments: investmentData(req.user.id) })
      return res.status(409).json({ message: 'Esta solicitud ya fue utilizada para otra operación.' })
    }
    const position = db.prepare('SELECT * FROM investment_positions WHERE id = ? AND user_id = ?')
      .get(req.params.investmentId, req.user.id)
    if (!position) return res.status(404).json({ message: 'No se encontró esta inversión.' })
    if (position.status !== 'active') return res.status(409).json({ message: 'Esta inversión ya fue retirada.' })
    if (Date.parse(position.matures_at) > Date.now()) {
      return res.status(409).json({ message: 'Podrás retirar esta inversión cuando termine el plazo acordado.' })
    }

    const source = checkingAccount(req.user.id)
    const asset = investmentAssetBySymbol(position.symbol)
    const currentPrice = marketQuote(asset).price
    const payout = Math.round(position.shares_scaled * currentPrice / 1000000000)
    const closedAt = now()
    const transactionId = payout > 0 ? crypto.randomUUID() : null
    const holdings = db.prepare("SELECT id FROM accounts WHERE id = 'system-investment-holdings'").get()
    try {
      const closeInvestment = db.transaction(() => {
        const currentPosition = db.prepare('SELECT * FROM investment_positions WHERE id = ? AND user_id = ?')
          .get(position.id, req.user.id)
        if (!currentPosition || currentPosition.status !== 'active') throw new BankingError('Esta inversión ya fue retirada.', 409)
        const currentSource = checkingAccount(req.user.id)
        if (!currentSource) throw new BankingError('No hay una cuenta principal disponible.', 409)
        if (transactionId) {
          db.prepare(`
            INSERT INTO transactions (id, user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, idempotency_key)
            VALUES (?, ?, 'income', ?, ?, 'Inversiones', 'Procesado', ?, ?, ?, ?)
          `).run(transactionId, req.user.id, payout, `Retiro de inversión ${position.symbol}`, closedAt, currentSource.id, holdings.id, key)
          db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(payout, currentSource.id)
          db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(payout, holdings.id)
          db.prepare(`
            INSERT INTO ledger_entries (id, transaction_id, account_id, side, amount, created_at)
            VALUES (?, ?, ?, 'credit', ?, ?), (?, ?, ?, 'debit', ?, ?)
          `).run(crypto.randomUUID(), transactionId, currentSource.id, payout, closedAt, crypto.randomUUID(), transactionId, holdings.id, payout, closedAt)
        }
        db.prepare(`
          UPDATE investment_positions
          SET status = 'closed', payout = ?, close_transaction_id = ?, closed_at = ?
          WHERE id = ?
        `).run(payout, transactionId, closedAt, position.id)
        audit(req.user.id, 'banking.investment.withdrawn', { positionId: position.id, symbol: position.symbol, invested: position.amount, payout })
      })
      closeInvestment()
      return res.json({ summary: getSummary(req.user.id), investments: investmentData(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return res.status(error.status).json({ message: error.message })
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && key) return res.status(409).json({ message: 'Esta solicitud ya fue procesada.' })
      throw error
    }
  })

  app.post('/api/transfers', requireAuth, (req, res) => {
    const { recipient, recipientId, account, amount, type = 'third' } = req.body || {}
    const value = Number(amount)
    const key = idempotencyKey(req, req.body)
    const source = checkingAccount(req.user.id)
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) return res.status(prior.status === 'Procesado' ? 200 : 409).json({ transaction: transactionView(prior, req.user.id) })
    const fail = (message, status = 400) => {
      const rejected = writeRejected({ userId: req.user.id, amount: value, type: 'transfer', description: message, category: 'Transferencias', accountId: source?.id, key })
      return res.status(status).json({ message, transaction: transactionView(rejected, req.user.id) })
    }

    if (!source) return fail('No existe una cuenta principal activa.', 409)
    if (!money(value)) return fail('El monto debe ser un número entero positivo en COP.')
    const normalizedAccount = normalizeAccount(account)
    const rawAccount = String(account || '').trim()
    const normalizedName = String(recipient || '').trim().toLocaleLowerCase('es-CO')
    if (!rawAccount && !recipientId) return fail('Completa el destinatario y el documento o teléfono.')
    if (type === 'interbank') return fail('Las transferencias externas no están habilitadas en el simulador.', 422)

    const destination = db.prepare(`
      SELECT u.*, a.id AS account_id FROM users u
      JOIN accounts a ON a.user_id = u.id AND a.kind = 'checking'
      WHERE u.status = 'active' AND (? IS NULL OR u.id = ?)
        AND (u.id = ? OR (? != '' AND (u.document = ? OR u.phone = ?)))
    `).get(recipientId || null, recipientId || null, rawAccount, normalizedAccount, normalizedAccount, normalizedAccount)
    const destinationName = destination && `${destination.first_name} ${destination.last_name}`.trim().toLocaleLowerCase('es-CO')
    const accountMatchesDestination = destination && (!rawAccount || rawAccount === destination.id || normalizeAccount(destination.document) === normalizedAccount || normalizeAccount(destination.phone) === normalizedAccount)
    if (!destination || !accountMatchesDestination || (normalizedName && normalizedName !== destinationName && normalizedName !== destination.id.toLocaleLowerCase('es-CO'))) {
      return fail('No se encontró una cuenta Fastbank activa con esos datos.', 404)
    }
    if (destination.id === req.user.id) return fail('No puedes transferir a tu misma cuenta principal.')

    try {
      const row = createMovement({
        userId: req.user.id,
        counterpartyUserId: destination.id,
        amount: value,
        type: 'transfer',
        description: `Transferencia a ${destination.first_name} ${destination.last_name}`,
        category: 'Transferencias',
        accountId: source.id,
        counterpartyAccountId: destination.account_id,
        key,
        entries: [{ accountId: source.id, side: 'debit' }, { accountId: destination.account_id, side: 'credit' }],
      })
      return res.status(201).json({ transaction: transactionView(row, req.user.id), summary: getSummary(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return fail(error.message, error.status)
      if (key) {
        const duplicate = transactionByIdempotency(req.user.id, key)
        if (duplicate) return res.status(200).json({ transaction: transactionView(duplicate, req.user.id) })
      }
      throw error
    }
  })

  app.post('/api/services/payments', requireAuth, (req, res) => {
    const { serviceId, planId } = req.body || {}
    let amount = Number(req.body?.amount)
    const reference = String(req.body?.reference || '').trim()
    const service = serviceById(serviceId)
    const plan = planId ? rechargePlanById(planId) : null
    const key = idempotencyKey(req, req.body)
    const source = checkingAccount(req.user.id)
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) return res.status(prior.status === 'Procesado' ? 200 : 409).json({ transaction: transactionView(prior, req.user.id) })
    const fail = (message, status = 400) => {
      const rejected = writeRejected({
        userId: req.user.id,
        amount,
        type: 'expense',
        description: message,
        category: 'Pagos y recargas',
        accountId: source?.id,
        key,
      })
      return res.status(status).json({ message, transaction: transactionView(rejected, req.user.id) })
    }

    if (!source) return fail('No existe una cuenta principal activa.', 409)
    if (!service) return fail('Selecciona un servicio válido.')
    if (service.category === 'mobile') {
      if (!plan || plan.serviceId !== service.id) return fail('Selecciona un plan disponible para este operador.')
      if (amount !== plan.price) return fail('El precio no coincide con el plan seleccionado.')
      amount = plan.price
    } else if (planId) {
      return fail('Los planes de recarga solo aplican a telefonía móvil.')
    }
    if (!money(amount) || amount < 1000 || amount > 5000000) {
      return fail('El monto debe ser un valor entero entre $1.000 y $5.000.000 COP.')
    }

    const validReference = service.referenceType === 'phone'
      ? /^3\d{9}$/.test(reference)
      : service.referenceType === 'email'
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reference) && reference.length <= 120
        : /^[A-Za-z0-9][A-Za-z0-9 .#/-]{2,63}$/.test(reference)
    if (!validReference) {
      const message = service.referenceType === 'phone'
        ? 'Ingresa un celular colombiano válido de 10 dígitos que comience por 3.'
        : service.referenceType === 'email'
          ? 'Ingresa un correo válido para la cuenta del servicio.'
          : 'Ingresa una referencia válida de 3 a 64 caracteres.'
      return fail(message)
    }

    try {
      const row = createMovement({
        userId: req.user.id,
        amount,
        type: 'expense',
        description: service.category === 'mobile'
          ? `${service.name} · ${plan.data} · ${plan.validity}`
          : `${service.name} · pago`,
        category: 'Pagos y recargas',
        accountId: source.id,
        counterpartyAccountId: 'system-service-clearing',
        key,
        entries: [
          { accountId: source.id, side: 'debit' },
          { accountId: 'system-service-clearing', side: 'credit' },
        ],
      })
      return res.status(201).json({ transaction: transactionView(row, req.user.id), summary: getSummary(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return fail(error.message, error.status)
      if (key) {
        const duplicate = transactionByIdempotency(req.user.id, key)
        if (duplicate) return res.status(200).json({ transaction: transactionView(duplicate, req.user.id) })
      }
      throw error
    }
  })

  app.post('/api/pockets', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim()
    const goal = Number(req.body?.goal)
    if (!name || name.length > 80 || !money(goal)) return res.status(400).json({ message: 'Indica un nombre y una meta positiva en COP.' })
    const pocket = { id: crypto.randomUUID(), userId: req.user.id, kind: 'pocket', name, goal, createdAt: now() }
    db.prepare(`
      INSERT INTO accounts (id, user_id, kind, name, goal, balance, created_at)
      VALUES (@id, @userId, @kind, @name, @goal, 0, @createdAt)
    `).run(pocket)
    audit(req.user.id, 'banking.pocket.created', { pocketId: pocket.id, goal })
    res.status(201).json({ pocket: { id: pocket.id, name, goal, amount: 0, balance: 0, locked: false } })
  })

  app.patch('/api/pockets/:pocketId', requireAuth, (req, res) => {
    const { action } = req.body || {}
    const amount = Number(req.body?.amount)
    const key = idempotencyKey(req, req.body)
    const pocket = db.prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ? AND kind = 'pocket'").get(req.params.pocketId, req.user.id)
    const checking = checkingAccount(req.user.id)
    const type = action === 'deposit' ? 'expense' : 'income'
    const description = `${action === 'deposit' ? 'Depósito en' : 'Retiro de'} bolsillo · ${pocket?.name || 'desconocido'}`
    const fail = (message, status = 400) => {
      const rejected = writeRejected({ userId: req.user.id, amount, type, description: message, category: 'Bolsillos', accountId: checking?.id, key })
      return res.status(status).json({ message, transaction: transactionView(rejected, req.user.id) })
    }
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) return res.status(prior.status === 'Procesado' ? 200 : 409).json({ transaction: transactionView(prior, req.user.id) })
    if (!pocket || !checking) return fail('No se encontró el bolsillo o la cuenta principal.', 404)
    if (!['deposit', 'withdraw'].includes(action) || !money(amount)) return fail('Indica una operación y un monto entero positivo en COP.')
    if (action === 'withdraw' && pocket.locked) return fail('Desbloquea el bolsillo antes de retirar.', 409)

    try {
      const row = createMovement({
        userId: req.user.id,
        amount,
        type,
        description,
        category: 'Bolsillos',
        accountId: action === 'deposit' ? checking.id : pocket.id,
        counterpartyAccountId: action === 'deposit' ? pocket.id : checking.id,
        key,
        entries: action === 'deposit'
          ? [{ accountId: checking.id, side: 'debit' }, { accountId: pocket.id, side: 'credit' }]
          : [{ accountId: pocket.id, side: 'debit' }, { accountId: checking.id, side: 'credit' }],
      })
      return res.status(201).json({ transaction: transactionView(row, req.user.id), summary: getSummary(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return fail(error.message, error.status)
      throw error
    }
  })

  app.patch('/api/pockets/:pocketId/lock', requireAuth, (req, res) => {
    const locked = req.body?.locked
    if (typeof locked !== 'boolean') return res.status(400).json({ message: 'Indica si el bolsillo debe quedar bloqueado.' })
    const result = db.prepare("UPDATE accounts SET locked = ? WHERE id = ? AND user_id = ? AND kind = 'pocket'").run(Number(locked), req.params.pocketId, req.user.id)
    if (!result.changes) return res.status(404).json({ message: 'No se encontró el bolsillo.' })
    audit(req.user.id, 'banking.pocket.lock_changed', { pocketId: req.params.pocketId, locked })
    res.json({ pocketId: req.params.pocketId, locked })
  })

  app.get('/api/loans/assessment', requireAuth, (req, res) => res.json({ assessment: creditAssessment(req.user.id) }))

  app.post('/api/loans', requireAuth, (req, res) => {
    const amount = Number(req.body?.amount)
    const term = Number(req.body?.term)
    const key = idempotencyKey(req, req.body)
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) return res.status(prior.status === 'Procesado' ? 200 : 409).json({ transaction: transactionView(prior, req.user.id) })
    const checking = checkingAccount(req.user.id)
    const assessment = creditAssessment(req.user.id)
    const fail = (message, status = 400) => {
      const rejected = writeRejected({ userId: req.user.id, amount, type: 'expense', description: message, category: 'Préstamo', accountId: checking?.id, key })
      return res.status(status).json({ message, transaction: transactionView(rejected, req.user.id), assessment })
    }
    if (!checking) return fail('No existe una cuenta principal activa.', 409)
    if (!money(amount) || amount < 100000 || ![3, 6, 9, 12].includes(term)) return fail('El monto mínimo es $100.000 COP y el plazo debe ser 3, 6, 9 o 12 meses.')
    if (!assessment.eligible || amount > assessment.limit) return fail(`Solicitud no aprobada. Límite calculado: ${formatCurrency(assessment.limit)}.`, 403)
    if (db.prepare("SELECT 1 FROM loans WHERE user_id = ? AND status = 'active'").get(req.user.id)) return fail('Debes pagar el crédito activo antes de solicitar otro.', 409)

    const basisPoints = { 3: 1000, 6: 1500, 9: 1750, 12: 2000 }[term]
    const totalPayable = Math.ceil(amount * (10000 + basisPoints) / 10000)
    const monthlyPayment = Math.ceil(totalPayable / term)
    const loanId = crypto.randomUUID()
    const createdAt = now()
    const dueDate = new Date(Date.now() + term * 30 * 86400000).toISOString().slice(0, 10)
    try {
      const issueLoan = db.transaction(() => {
        const row = createMovement({
          userId: req.user.id,
          amount,
          type: 'income',
          description: 'Desembolso de FastCredit',
          category: 'Préstamo',
          accountId: 'system-loan-receivable',
          counterpartyAccountId: checking.id,
          key,
          entries: [
            { accountId: 'system-loan-receivable', side: 'debit', amount: totalPayable },
            { accountId: checking.id, side: 'credit' },
            { accountId: 'system-interest-income', side: 'credit', amount: totalPayable - amount },
          ],
        })
        db.prepare(`
          INSERT INTO loans (id, user_id, transaction_id, amount, term, rate_basis_points, total_payable, remaining_balance, status, due_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(loanId, req.user.id, row.id, amount, term, basisPoints, totalPayable, totalPayable, dueDate, createdAt, createdAt)
        audit(req.user.id, 'banking.loan.issued', { loanId, amount, term, assessment })
        return row
      })
      issueLoan()
      return res.status(201).json({ loan: { id: loanId, userId: req.user.id, amount, term, rate: basisPoints / 100, monthlyPayment, totalPayable, remainingBalance: totalPayable, status: 'active', dueDate }, summary: getSummary(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return fail(error.message, error.status)
      throw error
    }
  })

  app.post('/api/loans/:loanId/payments', requireAuth, (req, res) => {
    const loan = db.prepare("SELECT * FROM loans WHERE id = ? AND user_id = ? AND status = 'active'").get(req.params.loanId, req.user.id)
    const checking = checkingAccount(req.user.id)
    if (!loan || !checking) return res.status(404).json({ message: 'No se encontró un crédito activo.' })
    const scheduledAmount = Math.ceil(loan.total_payable / loan.term)
    const amount = req.body?.amount == null ? Math.min(scheduledAmount, loan.remaining_balance) : Number(req.body.amount)
    const key = idempotencyKey(req, req.body)
    const prior = transactionByIdempotency(req.user.id, key)
    if (prior) return res.status(prior.status === 'Procesado' ? 200 : 409).json({ transaction: transactionView(prior, req.user.id) })
    if (!money(amount) || amount > loan.remaining_balance) return res.status(400).json({ message: `El pago debe ser un entero positivo, hasta ${formatCurrency(loan.remaining_balance)}.` })

    const paymentId = crypto.randomUUID()
    const createdAt = now()
    try {
      const applyPayment = db.transaction(() => {
        const row = createMovement({
          userId: req.user.id,
          amount,
          type: 'expense',
          description: `Pago FastCredit · cuota ${paymentId.slice(0, 8)}`,
          category: 'Préstamo',
          accountId: checking.id,
          counterpartyAccountId: 'system-loan-receivable',
          key,
          entries: [{ accountId: checking.id, side: 'debit' }, { accountId: 'system-loan-receivable', side: 'credit' }],
        })
        const remaining = loan.remaining_balance - amount
        const paidOnTime = createdAt.slice(0, 10) <= loan.due_date
        let scoreIncrease = 0
        db.prepare(`
          INSERT INTO loan_payments (id, loan_id, transaction_id, amount, created_at) VALUES (?, ?, ?, ?, ?)
        `).run(paymentId, loan.id, row.id, amount, createdAt)
        db.prepare(`
          UPDATE loans SET remaining_balance = ?, status = ?, updated_at = ? WHERE id = ?
        `).run(remaining, remaining === 0 ? 'paid' : 'active', createdAt, loan.id)
        if (remaining === 0 && paidOnTime) {
          const user = db.prepare('SELECT trust_score FROM users WHERE id = ?').get(req.user.id)
          const updatedScore = Math.min(100, user.trust_score + 10)
          scoreIncrease = updatedScore - user.trust_score
          if (scoreIncrease > 0) {
            db.prepare('UPDATE users SET trust_score = ?, updated_at = ? WHERE id = ?')
              .run(updatedScore, createdAt, req.user.id)
          }
        }
        audit(req.user.id, 'banking.loan.payment', { loanId: loan.id, paymentId, amount, remaining, paidOnTime, scoreIncrease })
        return { remaining, scoreIncrease }
      })
      const { remaining, scoreIncrease } = applyPayment()
      return res.status(201).json({ payment: { id: paymentId, amount, remainingBalance: remaining, scoreIncrease }, summary: getSummary(req.user.id) })
    } catch (error) {
      if (error instanceof BankingError) return res.status(error.status).json({ message: error.message })
      throw error
    }
  })

  app.patch('/api/cards', requireAuth, (req, res) => {
    const { cardRequestId, locked, limit } = req.body || {}
    if (typeof cardRequestId !== 'string' || !cardRequestId) {
      return res.status(400).json({ message: 'Selecciona la tarjeta que deseas actualizar.' })
    }
    if (typeof locked !== 'boolean' && limit === undefined) return res.status(400).json({ message: 'Indica el estado o el límite de la tarjeta.' })
    if (limit !== undefined && (!Number.isSafeInteger(Number(limit)) || Number(limit) < 0 || Number(limit) > 10000000)) {
      return res.status(400).json({ message: 'El límite debe estar entre 0 y 10.000.000 COP.' })
    }
    const card = db.prepare(`
      SELECT id, card_kind, card_status, card_locked, card_limit
      FROM card_requests WHERE id = ? AND user_id = ?
    `).get(cardRequestId, req.user.id)
    if (!card || card.card_status !== 'active') {
      return res.status(404).json({ message: 'No se encontró una tarjeta activa para actualizar.' })
    }
    if (limit !== undefined && card.card_kind !== 'credit') {
      return res.status(400).json({ message: 'Solo las tarjetas de crédito tienen límite configurable.' })
    }
    if (typeof locked === 'boolean') {
      db.prepare('UPDATE card_requests SET card_locked = ? WHERE id = ? AND user_id = ?')
        .run(Number(locked), cardRequestId, req.user.id)
    }
    if (limit !== undefined) {
      db.prepare('UPDATE card_requests SET card_limit = ? WHERE id = ? AND user_id = ?')
        .run(Number(limit), cardRequestId, req.user.id)
    }
    const updatedCard = db.prepare('SELECT card_locked, card_limit FROM card_requests WHERE id = ?').get(cardRequestId)
    audit(req.user.id, 'banking.card.updated', {
      cardRequestId,
      locked: updatedCard.card_locked,
      limit: updatedCard.card_limit,
    })
    res.json({ cardRequestId, cardLocked: Boolean(updatedCard.card_locked), cardLimit: updatedCard.card_limit })
  })

  app.post('/api/transactions/:transactionId/reverse', requireAuth, requireAdmin, (req, res) => {
    const original = db.prepare("SELECT * FROM transactions WHERE id = ? AND status = 'Procesado'").get(req.params.transactionId)
    if (!original || !['transfer', 'expense', 'income'].includes(original.type) || !['Transferencias', 'Bolsillos'].includes(original.category)) {
      return res.status(404).json({ message: 'No se encontró una operación procesada que pueda revertirse.' })
    }
    const entries = db.prepare('SELECT account_id AS accountId, side, amount FROM ledger_entries WHERE transaction_id = ? ORDER BY id').all(original.id)
    if (entries.length !== 2 || entries[0].amount !== entries[1].amount) return res.status(409).json({ message: 'El movimiento no tiene un ledger balanceado.' })
    const reversalId = crypto.randomUUID()
    const createdAt = now()
    try {
      const reverse = db.transaction(() => {
        const row = db.prepare(`
          INSERT INTO transactions (id, user_id, counterparty_user_id, type, amount, description, category, status, created_at, account_id, counterparty_account_id, reference)
          VALUES (?, ?, ?, 'reversal', ?, ?, ?, 'Pendiente', ?, ?, ?, ?)
        `).run(reversalId, original.user_id, original.counterparty_user_id, original.amount, `Reverso de ${original.id}`, original.category, createdAt, original.counterparty_account_id, original.account_id, `reversal:${original.id}`)
        for (const entry of entries) postEntry(reversalId, entry.accountId, entry.side === 'debit' ? 'credit' : 'debit', entry.amount, createdAt)
        db.prepare("UPDATE transactions SET status = 'Revertido' WHERE id = ?").run(original.id)
        db.prepare("UPDATE transactions SET status = 'Procesado' WHERE id = ?").run(reversalId)
        audit(req.user.id, 'banking.transaction.reversed', { transactionId: original.id, reversalId })
        return db.prepare('SELECT * FROM transactions WHERE id = ?').get(reversalId)
      })
      const row = reverse()
      res.json({ transaction: transactionView(row, original.user_id) })
    } catch (error) {
      if (error instanceof BankingError) return res.status(error.status).json({ message: error.message })
      throw error
    }
  })

  const aviator = registerAviatorService({
    app,
    db,
    audit,
    requireAuth,
    checkingAccount,
    createCasinoMovement,
  })

  return { getSummary, creditAssessment, aviator }
}