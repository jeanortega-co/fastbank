import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'

const MIN_BET = 1000
const MAX_CONFIGURED_BET = 1000000
const MAX_CRASH_POINT = 1000
const MAX_DAILY_LIMIT = 10000000
const DEFAULT_MAX_BET = 500000
const DEFAULT_DAILY_BET_LIMIT = 2000000
const DEFAULT_DAILY_LOSS_LIMIT = 500000
const DEFAULT_HOUSE_EDGE = 0.03
const DEFAULT_HOUSE_EXPOSURE_LIMIT = 0.05
const BETTING_DURATION_MS = 10000
const ROUND_PAUSE_MS = 2500
const TICK_INTERVAL_MS = 50
const MULTIPLIER_GROWTH_MS = 10000
const STREAM_TICKET_TTL_MS = 30000
const HOUSE_ACCOUNT_ID = 'casino-house'

class AviatorError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const nowIso = (timestamp) => new Date(timestamp).toISOString()
const roundMultiplier = (value) => Math.floor(value * 100) / 100
const money = (value) => Number.isSafeInteger(value) && value > 0
const parseMoneyInteger = (value) => {
  if (Number.isSafeInteger(value)) return value
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return NaN
  const normalized = value.trim().replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '')
  if (!/^\d+$/.test(normalized)) return NaN
  return Number(normalized)
}
const isValidDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

const isAdult = (birthDate, today = new Date()) => {
  if (!isValidDate(birthDate)) return false
  const [year, month, day] = birthDate.split('-').map(Number)
  const todayDate = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (Date.UTC(year, month - 1, day) > todayDate) return false
  let age = today.getUTCFullYear() - year
  if (today.getUTCMonth() < month - 1 || (today.getUTCMonth() === month - 1 && today.getUTCDate() < day)) age -= 1
  return age >= 18
}

export const calculateCrashPoint = (serverSeed, roundId, houseEdge = DEFAULT_HOUSE_EDGE) => {
  const digest = createHmac('sha256', serverSeed).update(`aviator-crash-v1:${roundId}`).digest()
  const randomInteger = digest.readUInt32BE(0)
  const randomValue = randomInteger / 0x100000000

  // The crash point is floor((1 - houseEdge) / (1 - U), 2 decimals), clamped to 1.00x and 1000x.
  // Thus P(crash >= x) is approximately (1 - houseEdge) / x for cashouts up to 1000x.
  return Math.min(MAX_CRASH_POINT, Math.max(1, Math.floor(((1 - houseEdge) / (1 - randomValue)) * 100) / 100))
}

export const multiplierAt = (startedAt, timestamp = Date.now()) => {
  const start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt)
  if (!Number.isFinite(start)) return 1
  return Math.max(1, roundMultiplier(Math.exp(Math.max(0, timestamp - start) / MULTIPLIER_GROWTH_MS)))
}

const limitsView = (row) => ({
  maxBet: row.max_bet,
  dailyBetLimit: row.daily_bet_limit,
  dailyLossLimit: row.daily_loss_limit,
  selfExcludedUntil: row.self_excluded_until,
  ageVerifiedAt: row.age_verified_at,
})

export const registerAviatorService = ({
  app,
  db,
  audit,
  requireAuth,
  checkingAccount,
  createCasinoMovement,
  houseEdge = Number(process.env.AVIATOR_HOUSE_EDGE || DEFAULT_HOUSE_EDGE),
  bettingDurationMs = Number(process.env.AVIATOR_BETTING_DURATION_MS || BETTING_DURATION_MS),
  roundPauseMs = Number(process.env.AVIATOR_ROUND_PAUSE_MS || ROUND_PAUSE_MS),
  tickIntervalMs = TICK_INTERVAL_MS,
  clock = Date.now,
}) => {
  if (!Number.isFinite(houseEdge) || houseEdge < 0 || houseEdge >= 0.2) {
    throw new Error('AVIATOR_HOUSE_EDGE debe estar entre 0 y 0.2.')
  }

  const serverSeeds = new Map()
  const streamTickets = new Map()
  let timer = null

  const getValidStreamTicket = (ticket) => {
    const normalized = String(ticket || '').trim()
    if (!normalized) return null
    const record = streamTickets.get(normalized)
    if (!record) return null
    if (record.expiresAt <= Date.now() || record.consumed) {
      streamTickets.delete(normalized)
      return null
    }
    return record
  }

  const currentHouseExposureLimit = () => Number(process.env.AVIATOR_HOUSE_EXPOSURE_LIMIT || DEFAULT_HOUSE_EXPOSURE_LIMIT)

  const ensureLimits = (userId) => {
    db.prepare(`
      INSERT OR IGNORE INTO casino_limits (user_id, max_bet, daily_bet_limit, daily_loss_limit)
      VALUES (?, ?, ?, ?)
    `).run(userId, DEFAULT_MAX_BET, DEFAULT_DAILY_BET_LIMIT, DEFAULT_DAILY_LOSS_LIMIT)
    return db.prepare('SELECT * FROM casino_limits WHERE user_id = ?').get(userId)
  }

  const getCurrentRound = () => db.prepare(`
    SELECT * FROM aviator_rounds
    WHERE status IN ('betting', 'flying')
    ORDER BY rowid DESC LIMIT 1
  `).get()

  const getLatestRound = () => db.prepare('SELECT * FROM aviator_rounds ORDER BY rowid DESC LIMIT 1').get()

  const dailyTotals = (userId, timestamp = clock()) => {
    const startOfDay = new Date(timestamp)
    startOfDay.setUTCHours(0, 0, 0, 0)
    const totals = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS bet_total,
        COALESCE(SUM(amount - payout), 0) AS net_loss
      FROM aviator_bets
      WHERE user_id = ? AND created_at >= ? AND status != 'refunded'
    `).get(userId, nowIso(startOfDay.getTime()))
    return {
      betTotal: totals.bet_total,
      netLoss: Math.max(0, totals.net_loss),
    }
  }

  const createRound = () => {
    const id = randomUUID()
    const seed = randomBytes(32).toString('hex')
    const hash = createHash('sha256').update(seed).digest('hex')
    const crashPoint = calculateCrashPoint(seed, id, houseEdge)
    const bettingEndsAt = nowIso(clock() + bettingDurationMs)
    db.prepare(`
      INSERT INTO aviator_rounds (id, status, server_seed_hash, server_seed, crash_point, betting_ends_at)
      VALUES (?, 'betting', ?, NULL, ?, ?)
    `).run(id, hash, crashPoint, bettingEndsAt)
    serverSeeds.set(id, seed)
    return db.prepare('SELECT * FROM aviator_rounds WHERE id = ?').get(id)
  }

  const settleBet = (bet, multiplier, status = 'cashed_out') => {
    const payout = Math.floor(bet.amount * multiplier)
    if (!Number.isSafeInteger(payout) || payout <= 0) {
      throw new AviatorError('El premio calculado excede el monto permitido.', 409)
    }
    const account = checkingAccount(bet.user_id)
    if (!account) throw new AviatorError('No existe una cuenta principal activa.', 409)
    const key = `aviator:payout:${bet.id}`
    const settle = db.transaction(() => {
      const currentBet = db.prepare("SELECT * FROM aviator_bets WHERE id = ? AND status = 'active'").get(bet.id)
      if (!currentBet) throw new AviatorError('Esta apuesta ya fue resuelta.', 409)
      const round = db.prepare("SELECT * FROM aviator_rounds WHERE id = ? AND status = 'flying'").get(bet.round_id)
      if (!round || multiplier >= round.crash_point) throw new AviatorError('La ronda ya alcanzó el crash.', 409)

      createCasinoMovement({
        userId: bet.user_id,
        amount: payout,
        type: 'income',
        description: `Premio AVIATOR (${multiplier.toFixed(2)}x)`,
        accountId: HOUSE_ACCOUNT_ID,
        counterpartyAccountId: account.id,
        key,
        entries: [
          { accountId: HOUSE_ACCOUNT_ID, side: 'debit' },
          { accountId: account.id, side: 'credit' },
        ],
      })
      db.prepare(`
        UPDATE aviator_bets
        SET status = ?, cashout_multiplier = ?, payout = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(status, multiplier, payout, nowIso(clock()), bet.id)
      audit(bet.user_id, 'casino.aviator.payout', { betId: bet.id, roundId: bet.round_id, payout, multiplier })
      return db.prepare('SELECT * FROM aviator_bets WHERE id = ?').get(bet.id)
    })
    return settle()
  }

  const refundOrphanedRounds = () => {
    const interrupted = db.prepare("SELECT * FROM aviator_rounds WHERE status IN ('betting', 'flying') ORDER BY rowid").all()
    for (const round of interrupted) {
      const refund = db.transaction(() => {
        const activeBets = db.prepare("SELECT * FROM aviator_bets WHERE round_id = ? AND status = 'active'").all(round.id)
        for (const bet of activeBets) {
          const account = checkingAccount(bet.user_id)
          if (!account) throw new AviatorError(`No existe la cuenta principal para devolver la apuesta ${bet.id}.`, 409)
          createCasinoMovement({
            userId: bet.user_id,
            amount: bet.amount,
            type: 'income',
            description: 'Devolución de apuesta AVIATOR por interrupción de ronda',
            accountId: HOUSE_ACCOUNT_ID,
            counterpartyAccountId: account.id,
            key: `aviator:refund:${bet.id}`,
            entries: [
              { accountId: HOUSE_ACCOUNT_ID, side: 'debit' },
              { accountId: account.id, side: 'credit' },
            ],
          })
          db.prepare(`
            UPDATE aviator_bets
            SET status = 'refunded', payout = amount, updated_at = ?
            WHERE id = ? AND status = 'active'
          `).run(nowIso(clock()), bet.id)
        }
        db.prepare(`
          UPDATE aviator_rounds SET status = 'crashed', crashed_at = ?, server_seed = NULL WHERE id = ?
        `).run(nowIso(clock()), round.id)
      })
      refund()
      serverSeeds.delete(round.id)
    }
  }

  const crashRound = (round, timestamp) => {
    const seed = serverSeeds.get(round.id)
    if (!seed) throw new Error(`No se encontró el server seed en memoria para la ronda ${round.id}.`)
    const crash = db.transaction(() => {
      db.prepare(`
        UPDATE aviator_bets SET status = 'lost', payout = 0, updated_at = ?
        WHERE round_id = ? AND status = 'active'
      `).run(nowIso(timestamp), round.id)
      db.prepare(`
        UPDATE aviator_rounds SET status = 'crashed', server_seed = ?, crashed_at = ? WHERE id = ?
      `).run(seed, nowIso(timestamp), round.id)
    })
    crash()
    serverSeeds.delete(round.id)
    const participants = db.prepare('SELECT DISTINCT user_id FROM aviator_bets WHERE round_id = ?').all(round.id)
    for (const participant of participants) {
      audit(participant.user_id, 'casino.aviator.round.crashed', { roundId: round.id, crashPoint: round.crash_point })
    }
  }

  const advance = () => {
    let round = getCurrentRound()
    const timestamp = clock()
    if (!round) {
      const latest = getLatestRound()
      if (!latest || timestamp - Date.parse(latest.crashed_at) >= roundPauseMs) round = createRound()
      else return latest
    }

    if (round.status === 'betting') {
      if (timestamp < Date.parse(round.betting_ends_at)) return round
      db.prepare("UPDATE aviator_rounds SET status = 'flying', started_at = ? WHERE id = ? AND status = 'betting'")
        .run(nowIso(timestamp), round.id)
      round = db.prepare('SELECT * FROM aviator_rounds WHERE id = ?').get(round.id)
    }

    if (round.status !== 'flying') return round
    const multiplier = multiplierAt(round.started_at, timestamp)
    const automaticBets = db.prepare(`
      SELECT * FROM aviator_bets
      WHERE round_id = ? AND status = 'active' AND auto_cashout IS NOT NULL AND auto_cashout <= ?
      ORDER BY created_at, id
    `).all(round.id, multiplier)
    for (const bet of automaticBets) {
      if (bet.auto_cashout < round.crash_point) settleBet(bet, bet.auto_cashout)
    }

    if (multiplier >= round.crash_point) {
      crashRound(round, timestamp)
      return getLatestRound()
    }
    return db.prepare('SELECT * FROM aviator_rounds WHERE id = ?').get(round.id)
  }

  const publicRound = (round, userId) => {
    if (!round) return null
    const payload = {
      id: round.id,
      status: round.status,
      serverSeedHash: round.server_seed_hash,
      bettingEndsAt: round.betting_ends_at,
      startedAt: round.started_at,
      crashedAt: round.crashed_at,
      ...(round.status === 'crashed' ? { crashPoint: round.crash_point } : {}),
      ...(round.status === 'flying'
        ? { multiplier: multiplierAt(round.started_at, clock()) }
        : {}),
      bets: db.prepare(`
        SELECT id, slot, amount, auto_cashout AS autoCashout, status,
          cashout_multiplier AS cashoutMultiplier, payout, created_at AS createdAt
        FROM aviator_bets WHERE round_id = ? AND user_id = ? ORDER BY slot
      `).all(round.id, userId),
    }
    return payload
  }

  const streamAuth = (req, res, next) => {
    const ticket = String(req.query?.ticket || '').trim()
    const validTicket = getValidStreamTicket(ticket)
    if (!validTicket) {
      return res.status(401).json({ message: 'Ticket de stream inválido o vencido.' })
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(validTicket.userId, 'active')
    if (!user) return res.status(401).json({ message: 'Sesión inválida.' })
    if ((user.auth_version || 0) !== (db.prepare('SELECT auth_version FROM users WHERE id = ?').get(validTicket.userId)?.auth_version ?? 0)) {
      return res.status(401).json({ message: 'Tus credenciales cambiaron. Inicia sesión nuevamente.' })
    }
    validTicket.consumed = true
    streamTickets.delete(ticket)
    req.user = user
    next()
  }

  const respondWithError = (res, error) => {
    if (error instanceof AviatorError || Number.isInteger(error?.status)) {
      return res.status(error.status).json({ message: error.message })
    }
    throw error
  }

  app.get('/api/casino/aviator/state', requireAuth, (req, res) => {
    let round = getCurrentRound()
    if (!round) {
      round = advance()
    }
    res.json({ serverTime: Date.now(), round: publicRound(round, req.user.id) })
  })

  app.post('/api/casino/aviator/stream-ticket', requireAuth, (req, res) => {
    const ticket = randomBytes(32).toString('hex')
    const expiresAt = Date.now() + STREAM_TICKET_TTL_MS
    streamTickets.set(ticket, { userId: req.user.id, expiresAt, consumed: false })
    res.json({ ticket, expiresAt: new Date(expiresAt).toISOString() })
  })

  app.get('/api/casino/aviator/stream', streamAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const emit = (eventName, payload) => {
      if (res.writableEnded || res.destroyed) return
      res.write(`event: ${eventName}\n`)
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    const syncSnapshot = () => {
      const round = getCurrentRound() || advance()
      return { serverTime: Date.now(), round: publicRound(round, req.user.id) }
    }

    let lastStreamState = null
    let lastHeartbeatAt = Date.now()

    emit('state', syncSnapshot())
    lastStreamState = syncSnapshot()

    const interval = setInterval(() => {
      const snapshot = syncSnapshot()
      if (snapshot.round && (!lastStreamState || snapshot.round.id !== lastStreamState.round?.id || snapshot.round.status !== lastStreamState.round?.status)) {
        emit('state', snapshot)
        lastStreamState = snapshot
      }
      if (Date.now() - lastHeartbeatAt > 15000) {
        emit('heartbeat', { serverTime: Date.now() })
        lastHeartbeatAt = Date.now()
      }
    }, 1000)

    req.on('close', () => {
      clearInterval(interval)
    })
  })

  app.post('/api/casino/aviator/bet', requireAuth, (req, res) => {
    const { slot, amount, auto_cashout: autoCashout } = req.body || {}
    const key = String(req.get('Idempotency-Key') || req.body?.idempotency_key || '').trim()
    if (!Number.isInteger(slot) || ![1, 2].includes(slot)) return res.status(400).json({ message: 'El espacio de apuesta debe ser 1 o 2.' })
    if (!money(amount) || amount < MIN_BET) return res.status(400).json({ message: `La apuesta mínima es ${MIN_BET} COP y debe ser un entero.` })
    if (autoCashout != null && (typeof autoCashout !== 'number' || !Number.isFinite(autoCashout) || autoCashout < 1.01 || autoCashout > 1000 || Math.round(autoCashout * 100) / 100 !== autoCashout)) {
      return res.status(400).json({ message: 'El retiro automático debe ser un multiplicador entre 1.01x y 1000.00x.' })
    }
    if (!key || key.length > 100) return res.status(400).json({ message: 'Se requiere una clave de idempotencia válida.' })

    const previousBet = db.prepare('SELECT * FROM aviator_bets WHERE user_id = ? AND idempotency_key = ?').get(req.user.id, key)
    if (previousBet) {
      if (previousBet.slot !== slot || previousBet.amount !== amount || previousBet.auto_cashout !== (autoCashout ?? null)) {
        return res.status(409).json({ message: 'La clave de idempotencia ya se utilizó con otra apuesta.' })
      }
      return res.status(200).json({ bet: previousBet, replayed: true })
    }

    try {
      advance()
      const limits = ensureLimits(req.user.id)
      const timestamp = clock()
      if (limits.self_excluded_until && Date.parse(limits.self_excluded_until) > timestamp) {
        throw new AviatorError('Tu autoexclusión está activa.', 403)
      }
      if (amount > Math.min(limits.max_bet, MAX_CONFIGURED_BET)) throw new AviatorError('La apuesta supera tu límite máximo configurado.', 400)
      const totals = dailyTotals(req.user.id, timestamp)
      if (totals.betTotal + amount > limits.daily_bet_limit) throw new AviatorError('La apuesta supera tu límite diario de apuestas.', 400)
      if (totals.netLoss + amount > limits.daily_loss_limit) throw new AviatorError('La apuesta podría superar tu límite diario de pérdidas.', 400)

      const round = getCurrentRound()
      if (!round || round.status !== 'betting' || timestamp >= Date.parse(round.betting_ends_at)) {
        throw new AviatorError('Solo puedes apostar durante la fase de apuestas.', 409)
      }
      if (db.prepare('SELECT id FROM aviator_bets WHERE round_id = ? AND user_id = ? AND slot = ?').get(round.id, req.user.id, slot)) {
        throw new AviatorError('Este espacio ya tiene una apuesta en la ronda actual.', 409)
      }
      const account = checkingAccount(req.user.id)
      if (!account) throw new AviatorError('No existe una cuenta principal activa.', 409)
      if (account.balance < amount) throw new AviatorError('No tienes saldo suficiente para completar la apuesta.', 409)

      const betId = randomUUID()
      const createdAt = nowIso(timestamp)
      const placeBet = db.transaction(() => {
        const currentRound = db.prepare("SELECT * FROM aviator_rounds WHERE id = ? AND status = 'betting'").get(round.id)
        const currentLimits = ensureLimits(req.user.id)
        const currentTimestamp = clock()
        if (!currentRound || currentTimestamp >= Date.parse(currentRound.betting_ends_at)) {
          throw new AviatorError('Solo puedes apostar durante la fase de apuestas.', 409)
        }
        if (currentLimits.self_excluded_until && Date.parse(currentLimits.self_excluded_until) > currentTimestamp) {
          throw new AviatorError('Tu autoexclusión está activa.', 403)
        }
        if (amount > Math.min(currentLimits.max_bet, MAX_CONFIGURED_BET)) {
          throw new AviatorError('La apuesta supera tu límite máximo configurado.', 400)
        }
        const currentTotals = dailyTotals(req.user.id, currentTimestamp)
        if (currentTotals.betTotal + amount > currentLimits.daily_bet_limit) {
          throw new AviatorError('La apuesta supera tu límite diario de apuestas.', 400)
        }
        if (currentTotals.netLoss + amount > currentLimits.daily_loss_limit) {
          throw new AviatorError('La apuesta podría superar tu límite diario de pérdidas.', 400)
        }
        if (db.prepare('SELECT id FROM aviator_bets WHERE round_id = ? AND user_id = ? AND slot = ?')
          .get(round.id, req.user.id, slot)) {
          throw new AviatorError('Este espacio ya tiene una apuesta en la ronda actual.', 409)
        }
        const activeLiability = db.prepare(`
          SELECT amount, crash_point AS crashPoint
          FROM aviator_bets JOIN aviator_rounds ON aviator_rounds.id = aviator_bets.round_id
          WHERE aviator_bets.status = 'active'
        `).all().reduce((sum, activeBet) => sum + Math.floor(activeBet.amount * Math.min(activeBet.crashPoint, MAX_CRASH_POINT)), 0)
        const house = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(HOUSE_ACCOUNT_ID)
        const newLiability = Math.floor(amount * Math.min(currentRound.crash_point, MAX_CRASH_POINT))
        if (!house || house.balance + amount < activeLiability + newLiability) {
          throw new AviatorError('La casa no tiene liquidez disponible para aceptar esta apuesta.', 409)
        }
        createCasinoMovement({
          userId: req.user.id,
          amount,
          type: 'expense',
          description: `Apuesta AVIATOR · ronda ${round.id} · espacio ${slot}`,
          accountId: account.id,
          counterpartyAccountId: HOUSE_ACCOUNT_ID,
          key: `aviator:bet:${key}`,
          entries: [
            { accountId: account.id, side: 'debit' },
            { accountId: HOUSE_ACCOUNT_ID, side: 'credit' },
          ],
        })
        db.prepare(`
          INSERT INTO aviator_bets (
            id, round_id, user_id, slot, amount, auto_cashout, status, cashout_multiplier,
            payout, idempotency_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, 0, ?, ?, ?)
        `).run(betId, round.id, req.user.id, slot, amount, autoCashout ?? null, key, createdAt, createdAt)
        audit(req.user.id, 'casino.aviator.bet', { betId, roundId: round.id, amount, slot })
        return db.prepare('SELECT * FROM aviator_bets WHERE id = ?').get(betId)
      })
      return res.status(201).json({ bet: placeBet() })
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const replay = db.prepare('SELECT * FROM aviator_bets WHERE user_id = ? AND idempotency_key = ?')
          .get(req.user.id, key)
        if (replay && replay.slot === slot && replay.amount === amount && replay.auto_cashout === (autoCashout ?? null)) {
          return res.status(200).json({ bet: replay, replayed: true })
        }
        return res.status(409).json({ message: 'El espacio o la clave de idempotencia ya se utilizó.' })
      }
      return respondWithError(res, error)
    }
  })

  app.post('/api/casino/aviator/cashout', requireAuth, (req, res) => {
    const { slot } = req.body || {}
    if (!Number.isInteger(slot) || ![1, 2].includes(slot)) return res.status(400).json({ message: 'El espacio de apuesta debe ser 1 o 2.' })
    try {
      const round = advance()
      if (!round || round.status !== 'flying') throw new AviatorError('Solo puedes retirar durante el vuelo.', 409)
      const bet = db.prepare(`
        SELECT * FROM aviator_bets
        WHERE round_id = ? AND user_id = ? AND slot = ? AND status = 'active'
      `).get(round.id, req.user.id, slot)
      if (!bet) throw new AviatorError('No tienes una apuesta activa en este espacio.', 409)
      const currentMultiplier = multiplierAt(round.started_at, clock())
      if (currentMultiplier >= round.crash_point) {
        advance()
        throw new AviatorError('La ronda ya alcanzó el crash.', 409)
      }
      const settledBet = settleBet(bet, currentMultiplier)
      return res.json({ bet: settledBet })
    } catch (error) {
      return respondWithError(res, error)
    }
  })

  app.get('/api/casino/aviator/history', requireAuth, (req, res) => {
    const rounds = db.prepare(`
      SELECT id, server_seed_hash AS serverSeedHash, crash_point AS crashPoint, crashed_at AS crashedAt
      FROM aviator_rounds
      WHERE status = 'crashed' AND server_seed IS NOT NULL
      ORDER BY rowid DESC LIMIT 20
    `).all()
    const bets = db.prepare(`
      SELECT id, round_id AS roundId, slot, amount, auto_cashout AS autoCashout, status,
        cashout_multiplier AS cashoutMultiplier, payout, created_at AS createdAt
      FROM aviator_bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(req.user.id)
    res.json({ rounds, bets })
  })

  app.get('/api/casino/aviator/verify/:roundId', requireAuth, (req, res) => {
    const round = db.prepare('SELECT * FROM aviator_rounds WHERE id = ?').get(req.params.roundId)
    if (!round || round.status !== 'crashed' || !round.server_seed) {
      return res.status(404).json({ message: 'La ronda no ha terminado o fue interrumpida y no tiene una prueba verificable.' })
    }
    const hash = createHash('sha256').update(round.server_seed).digest('hex')
    const crashPoint = calculateCrashPoint(round.server_seed, round.id, houseEdge)
    if (hash !== round.server_seed_hash || crashPoint !== round.crash_point) {
      return res.status(409).json({ message: 'La prueba de imparcialidad de esta ronda no coincide.' })
    }
    return res.json({
      roundId: round.id,
      serverSeed: round.server_seed,
      serverSeedHash: round.server_seed_hash,
      crashPoint: round.crash_point,
    })
  })

  app.get('/api/casino/limits', requireAuth, (req, res) => {
    const limits = ensureLimits(req.user.id)
    res.json({ limits: limitsView(limits), today: dailyTotals(req.user.id) })
  })

  app.put('/api/casino/limits', requireAuth, (req, res) => {
    const body = req.body || {}
    const allowedKeys = new Set(['maxBet', 'dailyBetLimit', 'dailyLossLimit', 'selfExcludedUntil'])
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return res.status(400).json({ message: 'La solicitud contiene campos de límites no admitidos.' })
    }
    const limits = ensureLimits(req.user.id)
    const values = {
      maxBet: limits.max_bet,
      dailyBetLimit: limits.daily_bet_limit,
      dailyLossLimit: limits.daily_loss_limit,
      selfExcludedUntil: limits.self_excluded_until,
      ageVerifiedAt: limits.age_verified_at,
    }

    for (const [field, maximum] of [['maxBet', MAX_CONFIGURED_BET], ['dailyBetLimit', MAX_DAILY_LIMIT], ['dailyLossLimit', MAX_DAILY_LIMIT]]) {
      if (Object.hasOwn(body, field)) {
        const value = body[field]
        if (!Number.isSafeInteger(value) || value < MIN_BET || value > maximum) {
          return res.status(400).json({ message: `${field} debe ser un entero entre ${MIN_BET} y ${maximum} COP.` })
        }
        values[field] = value
      }
    }

    if (Object.hasOwn(body, 'selfExcludedUntil')) {
      const until = body.selfExcludedUntil
      if (until !== null && (typeof until !== 'string' || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= clock())) {
        return res.status(400).json({ message: 'La fecha de autoexclusión debe ser futura o nula.' })
      }
      const currentExclusion = limits.self_excluded_until ? Date.parse(limits.self_excluded_until) : 0
      if (currentExclusion > clock() && (!until || Date.parse(until) < currentExclusion)) {
        return res.status(400).json({ message: 'No puedes acortar una autoexclusión que sigue activa.' })
      }
      values.selfExcludedUntil = until
    }

    db.prepare(`
      UPDATE casino_limits
      SET max_bet = ?, daily_bet_limit = ?, daily_loss_limit = ?,
        self_excluded_until = ?, age_verified_at = ?
      WHERE user_id = ?
    `).run(values.maxBet, values.dailyBetLimit, values.dailyLossLimit, values.selfExcludedUntil, values.ageVerifiedAt, req.user.id)
    audit(req.user.id, 'casino.limits.updated', {
      maxBet: values.maxBet,
      dailyBetLimit: values.dailyBetLimit,
      dailyLossLimit: values.dailyLossLimit,
      selfExcludedUntil: values.selfExcludedUntil,
      ageVerified: Boolean(values.ageVerifiedAt),
    })
    return res.json({ limits: limitsView(ensureLimits(req.user.id)) })
  })

  const start = () => {
    if (timer) return
    refundOrphanedRounds()

    const ensureRound = () => {
      const current = getCurrentRound()
      if (current) return advance()
      const latest = getLatestRound()
      if (!latest || latest.status === 'crashed' && (!latest.crashed_at || clock() - Date.parse(latest.crashed_at) >= roundPauseMs)) {
        return createRound()
      }
      return latest
    }

    ensureRound()
    timer = setInterval(() => {
      try {
        if (!db.open) {
          stop()
          return
        }
        const current = getCurrentRound()
        if (!current) {
          const latest = getLatestRound()
          if (!latest || latest.status === 'crashed' && (!latest.crashed_at || clock() - Date.parse(latest.crashed_at) >= roundPauseMs)) {
            createRound()
          }
        }
        advance()
      } catch (error) {
        console.error('Aviator round advancement failed.', error)
        stop()
      }
    }, tickIntervalMs)
    timer.unref?.()
  }

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return { start, stop, advance, getCurrentRound, createRound }
}
