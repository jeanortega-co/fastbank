import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { generateSecret, generateURI, verify } from 'otplib'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit, db, ensurePostgresSchema, pgPool, publicUser } from './db.js'
import { isSmtpConfigured, sendPasswordResetEmail, sendRegistrationVerificationEmail } from './email.js'
import { registerBankingRoutes } from './banking.js'
import { registerWebAuthnRoutes } from './webauthn.js'

const app = express()
const port = Number(process.env.PORT || 3002)
const jwtSecret = process.env.JWT_SECRET || 'REMOVED'
const isProduction = process.env.NODE_ENV === 'production'

if (isProduction && jwtSecret === 'REMOVED') {
  throw new Error('JWT_SECRET debe configurarse en producción.')
}

const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('Origen del cliente no autorizado.'))
  },
}))
app.use(express.json({ limit: '5mb' }))

const issueToken = (user) => jwt.sign({ sub: user.id, role: user.role, authVersion: user.auth_version || 0 }, jwtSecret, { expiresIn: '2h' })
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(id, 'active')

const getRegistrationNumberError = (document, phone) => {
  if (typeof document !== 'string' || !/^\d*$/.test(document.trim())) {
    return 'La cédula solo debe contener números.'
  }
  if (document.trim().length < 6) {
    const missing = 6 - document.trim().length
    return `A la cédula le faltan ${missing} ${missing === 1 ? 'número' : 'números'}.`
  }
  if (document.trim().length > 10) {
    return 'La cédula no puede superar 10 números.'
  }
  if (typeof phone !== 'string' || !/^\d*$/.test(phone.trim())) {
    return 'El celular solo debe contener números.'
  }
  if (phone.trim().length < 10) {
    const missing = 10 - phone.trim().length
    return `Al celular le faltan ${missing} ${missing === 1 ? 'número' : 'números'}.`
  }
  if (!/^3\d{9}$/.test(phone.trim())) {
    return 'El celular debe tener 10 números y comenzar por 3.'
  }
  return null
}

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ message: 'Autenticación requerida.' })

  try {
    const payload = jwt.verify(token, jwtSecret)
    const user = getUser(payload.sub)
    if (!user) return res.status(401).json({ message: 'Sesión inválida.' })
    if ((payload.authVersion || 0) !== user.auth_version) {
      return res.status(401).json({ message: 'Tus credenciales cambiaron. Inicia sesión nuevamente.' })
    }
    req.user = user
    next()
  } catch {
    return res.status(401).json({ message: 'Sesión expirada o inválida.' })
  }
}

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acceso administrativo requerido.' })
  next()
}

const requestIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null
const findByIdentifier = (identifier) => db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) OR document = ?').get(identifier, identifier)
const passwordResetAttempts = new Map()
const RESET_WINDOW_MS = 15 * 60 * 1000

const isPasswordResetRateLimited = (key, limit, timestamp = Date.now()) => {
  const attempts = (passwordResetAttempts.get(key) || []).filter((attempt) => timestamp - attempt < RESET_WINDOW_MS)
  if (attempts.length >= limit) {
    passwordResetAttempts.set(key, attempts)
    return true
  }
  attempts.push(timestamp)
  passwordResetAttempts.set(key, attempts)
  return false
}

const issueCredentialReset = async (user, createdBy, purpose) => {
  const timestamp = new Date().toISOString()
  const token = String(randomInt(0, 100000)).padStart(5, '0')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const createReset = db.transaction(() => {
    db.prepare('DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= ?').run(timestamp)
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .run(timestamp, user.id)
    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), user.id, tokenHash, purpose, expiresAt, createdBy, timestamp)
  })
  createReset()
  try {
    await sendPasswordResetEmail({ to: user.email, token, expiresAt, purpose })
    return true
  } catch (error) {
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
      .run(new Date().toISOString(), tokenHash)
    console.error('Password reset email delivery failed.', { code: error.code, command: error.command })
    return false
  }
}

registerWebAuthnRoutes({ app, db, audit, publicUser, issueToken, requireAuth, allowedOrigins })
const createCardNumber = () => {
  const digits = Array.from({ length: 15 }, () => randomInt(0, 10))
  const checksum = digits.reduce((sum, digit, index) => {
    const position = 15 - index
    const value = index % 2 === 0 ? digit * 2 : digit
    return sum + (value > 9 ? value - 9 : value)
  }, 0)
  digits.push((10 - (checksum % 10)) % 10)
  return digits.join('')
}

const createUniqueCard = () => {
  let cardNumber = createCardNumber()
  return { cardNumber, cvv: String(randomInt(100, 1000)) }
}

const createUniqueRequestedCard = (reservedCardNumbers = new Set()) => {
  let card = createUniqueCard()
  while (
    db.prepare('SELECT 1 FROM users WHERE card_number = ?').get(card.cardNumber) ||
    db.prepare('SELECT 1 FROM card_requests WHERE card_number = ?').get(card.cardNumber) ||
    reservedCardNumbers.has(card.cardNumber)
  ) {
    card = createUniqueCard()
  }
  reservedCardNumbers.add(card.cardNumber)
  return card
}

for (const request of db.prepare(`
  SELECT id, card_type AS cardType, card_number AS cardNumber, created_at AS createdAt
  FROM card_requests
  WHERE card_number IS NULL AND status != 'rejected'
`).all()) {
  const card = createUniqueRequestedCard()
  const readyAt = new Date(new Date(request.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(`
    UPDATE card_requests
    SET card_number = ?, cvv = ?, card_status = ?, status = ?, estimated_ready_at = ?
    WHERE id = ?
  `).run(
    card.cardNumber,
    card.cvv,
    request.cardType === 'digital' ? 'active' : 'pending',
    request.cardType === 'digital' ? 'approved' : 'pending',
    request.cardType === 'physical' ? readyAt : null,
    request.id,
  )
}

const isAdult = (birthDate, currentDate = new Date()) => {
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false
  const [year, month, day] = birthDate.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed > new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()))
  ) return false

  let age = currentDate.getUTCFullYear() - year
  if (
    currentDate.getUTCMonth() < month - 1 ||
    (currentDate.getUTCMonth() === month - 1 && currentDate.getUTCDate() < day)
  ) age -= 1
  return age >= 18
}

const getDocumentImage = (image) => {
  if (typeof image !== 'string') return null
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
  if (!match) return null
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0 || buffer.length > 3 * 1024 * 1024) return null
  const validSignature = match[1] === 'jpeg'
    ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : match[1] === 'png'
      ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  return validSignature ? buffer : null
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'fastbank-api' }))

app.post('/api/auth/register/email-code', async (req, res) => {
  const { firstName, lastName, document, phone, email, birthDate } = req.body || {}
  const numberError = getRegistrationNumberError(document, phone)
  if (numberError) return res.status(400).json({ message: numberError })
  if (![firstName, lastName, document, phone, email, birthDate].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Completa todos los datos obligatorios.' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: 'Ingresa un correo electrónico válido.' })
  }
  if (!isAdult(birthDate)) return res.status(400).json({ message: 'Debes tener al menos 18 años para crear una cuenta.' })

  const normalizedEmail = email.trim().toLowerCase()
  const duplicate = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR document = ?').get(normalizedEmail, document.trim())
  if (duplicate) return res.status(409).json({ message: 'El correo o documento ya está registrado.' })
  if (!isSmtpConfigured()) {
    return res.status(503).json({ message: 'El envío de correo no está configurado. Revisa las variables SMTP del archivo .env.' })
  }

  const ipAddress = requestIp(req) || 'unknown'
  const emailKey = createHash('sha256').update(normalizedEmail).digest('hex')
  if (
    isPasswordResetRateLimited(`register-ip:${ipAddress}`, 10) ||
    isPasswordResetRateLimited(`register-email:${emailKey}`, 3)
  ) {
    return res.status(429).json({ message: 'Se hicieron demasiadas solicitudes. Inténtalo nuevamente en unos minutos.' })
  }

  const timestamp = new Date().toISOString()
  const code = String(randomInt(0, 100000)).padStart(5, '0')
  const codeHash = createHash('sha256').update(code).digest('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  db.prepare(`
    INSERT INTO email_verifications (email, code_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code_hash = excluded.code_hash,
      registration_token_hash = NULL,
      expires_at = excluded.expires_at,
      verified_at = NULL,
      used_at = NULL,
      attempts = 0,
      created_at = excluded.created_at
  `).run(normalizedEmail, codeHash, expiresAt, timestamp)

  try {
    const delivery = await sendRegistrationVerificationEmail({ to: normalizedEmail, code, expiresAt })
    if (!delivery.accepted) {
      throw new Error('El servidor de correo no confirmó la recepción del mensaje.')
    }
  } catch (error) {
    db.prepare('DELETE FROM email_verifications WHERE email = ? AND code_hash = ?').run(normalizedEmail, codeHash)
    console.error('Registration verification email delivery failed.', { code: error.code, command: error.command })
    return res.status(502).json({ message: error.message || 'No se pudo enviar el código. Verifica el correo e inténtalo nuevamente.' })
  }

  return res.json({ message: 'El servidor de correo aceptó el código para esa dirección. Si no aparece en la bandeja de entrada, revisa Spam, Promociones y correo no deseado. El código vence en 10 minutos.' })
})

app.post('/api/auth/register/email-code/verify', (req, res) => {
  const { email, code } = req.body || {}
  if (typeof email !== 'string' || typeof code !== 'string' || !/^\d{5}$/.test(code)) {
    return res.status(400).json({ message: 'Ingresa un correo y un código de exactamente 5 dígitos.' })
  }
  const normalizedEmail = email.trim().toLowerCase()
  const verification = db.prepare('SELECT * FROM email_verifications WHERE email = ?').get(normalizedEmail)
  if (!verification || verification.used_at || verification.expires_at <= new Date().toISOString()) {
    return res.status(400).json({ message: 'El código es inválido, venció o ya fue utilizado.' })
  }
  if (verification.attempts >= 5) {
    return res.status(429).json({ message: 'Se superó el número de intentos. Solicita un código nuevo.' })
  }
  const codeHash = createHash('sha256').update(code).digest('hex')
  if (codeHash !== verification.code_hash) {
    db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?').run(normalizedEmail)
    return res.status(400).json({ message: 'El código ingresado no es correcto.' })
  }

  const registrationToken = randomBytes(32).toString('hex')
  const verifiedAt = new Date().toISOString()
  const verificationUpdate = db.prepare(`
    UPDATE email_verifications SET registration_token_hash = ?, verified_at = ?
    WHERE email = ? AND used_at IS NULL AND expires_at > ?
  `).run(createHash('sha256').update(registrationToken).digest('hex'), verifiedAt, normalizedEmail, verifiedAt)
  if (!verificationUpdate.changes) {
    return res.status(400).json({ message: 'El código venció. Solicita uno nuevo e inténtalo otra vez.' })
  }
  return res.json({ registrationToken, message: 'Correo verificado correctamente.' })
})

app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, document, phone, email, birthDate, password, pin, registrationToken, documentImage } = req.body || {}
  const numberError = getRegistrationNumberError(document, phone)
  if (numberError) return res.status(400).json({ message: numberError })
  if (![firstName, lastName, document, phone, email, birthDate, password, pin, registrationToken].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Completa todos los datos obligatorios y verifica tu correo.' })
  }
  if (password.length < 4) {
    return res.status(400).json({ message: 'La contraseña debe tener mínimo 4 caracteres.' })
  }
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'El PIN debe tener exactamente 4 dígitos.' })
  if (!isAdult(birthDate)) return res.status(400).json({ message: 'Debes tener al menos 18 años para crear una cuenta.' })
  if (!getDocumentImage(documentImage)) {
    return res.status(400).json({ message: 'Carga una foto válida del documento de identidad (JPG, PNG o WebP; máximo 3 MB).' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const duplicate = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR document = ?').get(normalizedEmail, document.trim())
  if (duplicate) return res.status(409).json({ message: 'El correo o documento ya está registrado.' })
  const registrationTokenHash = createHash('sha256').update(registrationToken).digest('hex')
  const timestamp = new Date().toISOString()
  const verification = db.prepare(`
    SELECT email FROM email_verifications
    WHERE email = ? AND registration_token_hash = ? AND verified_at IS NOT NULL
      AND used_at IS NULL AND expires_at > ?
  `).get(normalizedEmail, registrationTokenHash, timestamp)
  if (!verification) return res.status(400).json({ message: 'Verifica tu correo antes de crear la cuenta.' })

  const user = {
    id: crypto.randomUUID(),
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    document: document.trim(),
    phone: phone.trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    pinHash: await bcrypt.hash(pin, 12),
    timestamp,
  }
  try {
    const createUser = db.transaction(() => {
      const consumedVerification = db.prepare(`
        UPDATE email_verifications SET used_at = ?
        WHERE email = ? AND registration_token_hash = ? AND verified_at IS NOT NULL
          AND used_at IS NULL AND expires_at > ?
      `).run(timestamp, normalizedEmail, registrationTokenHash, timestamp)
      if (!consumedVerification.changes) throw new Error('La verificación del correo venció o ya fue utilizada.')
      db.prepare(`
        INSERT INTO users (id, first_name, last_name, document, phone, email, password_hash, pin_hash, created_at, updated_at)
        VALUES (@id, @firstName, @lastName, @document, @phone, @email, @passwordHash, @pinHash, @timestamp, @timestamp)
      `).run(user)
      db.prepare(`
        INSERT INTO accounts (id, user_id, kind, name, balance, created_at)
        VALUES (?, ?, 'checking', 'Cuenta principal', 0, ?)
      `).run(`checking-${user.id}`, user.id, timestamp)
    })
    createUser()
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'El correo o documento ya está registrado.' })
    if (error.message === 'La verificación del correo venció o ya fue utilizada.') {
      return res.status(400).json({ message: 'La verificación del correo venció o ya fue utilizada.' })
    }
    throw error
  }
  if (pgPool) {
    try {
      await ensurePostgresSchema()
      await pgPool.query(`
        INSERT INTO users (
          id, first_name, last_name, document, phone, email, password_hash, pin_hash,
          role, status, trust_score, totp_enabled, auth_version, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'user','active',60,0,0,$9,$9)
        ON CONFLICT (id) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          document = EXCLUDED.document,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          pin_hash = EXCLUDED.pin_hash,
          updated_at = EXCLUDED.updated_at
      `, [
        user.id, user.firstName, user.lastName, user.document, user.phone, user.email,
        user.passwordHash, user.pinHash, user.timestamp,
      ])
      await pgPool.query(`
        INSERT INTO accounts (id, user_id, kind, name, balance, created_at)
        VALUES ($1,$2,'checking','Cuenta principal',0,$3)
        ON CONFLICT DO NOTHING
      `, [`checking-${user.id}`, user.id, user.timestamp])
    } catch (error) {
      console.error('Neon account mirror failed.', error)
    }
  }
  const created = getUser(user.id)
  audit(user.id, 'auth.registered', {}, requestIp(req))
  res.status(201).json({ token: issueToken(created), user: publicUser(created) })
})

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password, pin, code } = req.body || {}
  let user = findByIdentifier(String(identifier || '').trim())
  if (!user && pgPool) {
    try {
      await ensurePostgresSchema()
      const normalizedIdentifier = String(identifier || '').trim()
      const result = await pgPool.query(
        'SELECT * FROM users WHERE lower(email) = lower($1) OR document = $2 LIMIT 1',
        [normalizedIdentifier, normalizedIdentifier],
      )
      if (result.rows[0]) {
        const row = result.rows[0]
        db.prepare(`
          INSERT INTO users (
            id, first_name, last_name, document, phone, email, password_hash, pin_hash,
            role, status, trust_score, totp_secret, totp_pending_secret, totp_enabled,
            auth_version, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            password_hash = excluded.password_hash,
            pin_hash = excluded.pin_hash,
            updated_at = excluded.updated_at
        `).run(
          row.id, row.first_name, row.last_name, row.document, row.phone, row.email,
          row.password_hash, row.pin_hash, row.role, row.status, row.trust_score,
          row.totp_secret, row.totp_pending_secret, row.totp_enabled ? 1 : 0,
          row.auth_version || 0, row.created_at, row.updated_at,
        )
        const account = await pgPool.query(
          "SELECT * FROM accounts WHERE user_id = $1 AND kind = 'checking' LIMIT 1",
          [row.id],
        )
        if (account.rows[0]) {
          db.prepare(`
            INSERT INTO accounts (id, user_id, kind, name, goal, balance, locked, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO NOTHING
          `).run(
            account.rows[0].id, account.rows[0].user_id, account.rows[0].kind,
            account.rows[0].name, account.rows[0].goal, account.rows[0].balance,
            account.rows[0].locked, account.rows[0].created_at,
          )
        }
        user = findByIdentifier(normalizedIdentifier)
      }
    } catch (error) {
      console.error('Neon login fallback failed.', error)
    }
  }
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return res.status(401).json({ message: 'Credenciales incorrectas.' })
  }

  if (user.pin_hash && pin && !(await bcrypt.compare(String(pin), user.pin_hash))) {
    return res.status(401).json({ message: 'PIN incorrecto.' })
  }

  if (user.totp_enabled) {
    if (!code) return res.status(202).json({ requiresTwoFactor: true, message: 'Ingresa el código de autenticación.' })
    const result = await verify({ secret: user.totp_secret, token: String(code) })
    if (!result.valid) return res.status(401).json({ message: 'Código de autenticación inválido.' })
  }

  const timestamp = new Date().toISOString()
  db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(timestamp, user.id)
  audit(user.id, 'auth.login', { twoFactor: Boolean(user.totp_enabled) }, requestIp(req))
  return res.json({ token: issueToken(user), user: publicUser(user) })
})

app.post('/api/auth/password-reset/request', async (req, res) => {
  const { email } = req.body || {}
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: 'Ingresa un correo electrónico válido.' })
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({ message: 'El envío de correo no está configurado. Revisa las variables SMTP del archivo .env.' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const ipAddress = requestIp(req) || 'unknown'
  const emailKey = createHash('sha256').update(normalizedEmail).digest('hex')
  if (
    isPasswordResetRateLimited(`ip:${ipAddress}`, 10) ||
    isPasswordResetRateLimited(`email:${emailKey}`, 3)
  ) {
    return res.status(429).json({ message: 'Se hicieron demasiadas solicitudes. Inténtalo nuevamente en unos minutos.' })
  }

  const user = db.prepare(`
    SELECT id, email FROM users
    WHERE lower(email) = ? AND role = 'user' AND status = 'active'
  `).get(normalizedEmail)
  if (user) {
    const delivered = await issueCredentialReset(user, user.id, 'password')
    if (delivered) audit(user.id, 'auth.password_reset_requested', {}, ipAddress)
  }

  return res.json({
    message: 'Si el correo pertenece a una cuenta activa, enviaremos un código de verificación. Revisa también la carpeta de spam.',
  })
})

app.post('/api/auth/pin-reset/request', async (req, res) => {
  const { email } = req.body || {}
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: 'Ingresa un correo electrónico válido.' })
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({ message: 'El envío de correo no está configurado. Revisa las variables SMTP del archivo .env.' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const ipAddress = requestIp(req) || 'unknown'
  const emailKey = createHash('sha256').update(normalizedEmail).digest('hex')
  if (
    isPasswordResetRateLimited(`ip:${ipAddress}`, 10) ||
    isPasswordResetRateLimited(`email:${emailKey}`, 3)
  ) {
    return res.status(429).json({ message: 'Se hicieron demasiadas solicitudes. Inténtalo nuevamente en unos minutos.' })
  }

  const user = db.prepare(`
    SELECT id, email FROM users
    WHERE lower(email) = ? AND role = 'user' AND status = 'active'
  `).get(normalizedEmail)
  if (user) {
    const delivered = await issueCredentialReset(user, user.id, 'pin')
    if (delivered) audit(user.id, 'auth.pin_reset_requested', {}, ipAddress)
  }

  return res.json({
    message: 'Si el correo pertenece a una cuenta activa, enviaremos un código de verificación. Revisa también la carpeta de spam.',
  })
})

app.post('/api/auth/password-reset', async (req, res) => {
  const { email, token, password } = req.body || {}
  if (![email, token, password].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Ingresa tu correo, el código temporal y la nueva contraseña.' })
  }
  if (!/^\d{5}$/.test(token)) {
    return res.status(400).json({ message: 'El código debe tener exactamente 5 dígitos.' })
  }
  if (password.length < 4) {
    return res.status(400).json({ message: 'La contraseña debe tener mínimo 4 caracteres.' })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const timestamp = new Date().toISOString()
  const normalizedEmail = email.trim().toLowerCase()
  const passwordHash = await bcrypt.hash(password, 12)
  const resetPassword = db.transaction(() => {
    const resetToken = db.prepare(`
      SELECT password_reset_tokens.id, password_reset_tokens.user_id
      FROM password_reset_tokens
      JOIN users ON users.id = password_reset_tokens.user_id
      WHERE password_reset_tokens.token_hash = ?
        AND lower(users.email) = ?
        AND password_reset_tokens.purpose = 'password'
        AND password_reset_tokens.used_at IS NULL
        AND password_reset_tokens.expires_at > ?
        AND users.status = 'active'
    `).get(tokenHash, normalizedEmail, timestamp)
    if (!resetToken) return false

    db.prepare(`
      UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, timestamp, resetToken.user_id)
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .run(timestamp, resetToken.user_id)
    return resetToken.user_id
  })
  const userId = resetPassword()
  if (!userId) return res.status(400).json({ message: 'El código es inválido, venció o ya fue utilizado.' })

  audit(userId, 'auth.password_reset_completed', {}, requestIp(req))
  return res.json({ message: 'Contraseña restablecida. Inicia sesión con tu nueva contraseña.' })
})

app.post('/api/auth/pin-reset', async (req, res) => {
  const { email, token, pin } = req.body || {}
  if (![email, token, pin].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Ingresa tu correo, el código temporal y el nuevo PIN.' })
  }
  if (!/^\d{5}$/.test(token)) {
    return res.status(400).json({ message: 'El código debe tener exactamente 5 dígitos.' })
  }
  if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({ message: 'El PIN debe tener exactamente 4 dígitos.' })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const timestamp = new Date().toISOString()
  const normalizedEmail = email.trim().toLowerCase()
  const pinHash = await bcrypt.hash(pin, 12)
  const resetPin = db.transaction(() => {
    const resetToken = db.prepare(`
      SELECT password_reset_tokens.user_id
      FROM password_reset_tokens
      JOIN users ON users.id = password_reset_tokens.user_id
      WHERE password_reset_tokens.token_hash = ?
        AND lower(users.email) = ?
        AND password_reset_tokens.purpose = 'pin'
        AND password_reset_tokens.used_at IS NULL
        AND password_reset_tokens.expires_at > ?
        AND users.status = 'active'
    `).get(tokenHash, normalizedEmail, timestamp)
    if (!resetToken) return false

    db.prepare(`
      UPDATE users SET pin_hash = ?, auth_version = auth_version + 1, updated_at = ?
      WHERE id = ?
    `).run(pinHash, timestamp, resetToken.user_id)
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .run(timestamp, resetToken.user_id)
    return resetToken.user_id
  })
  const userId = resetPin()
  if (!userId) return res.status(400).json({ message: 'El código es inválido, venció o ya fue utilizado.' })

  audit(userId, 'auth.pin_reset_completed', {}, requestIp(req))
  return res.json({ message: 'PIN restablecido. Inicia sesión con tu nuevo PIN.' })
})

app.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  const secret = generateSecret()
  db.prepare('UPDATE users SET totp_pending_secret = ?, updated_at = ? WHERE id = ?').run(secret, new Date().toISOString(), req.user.id)
  const uri = generateURI({ issuer: 'Fastbank', label: req.user.email, secret })
  audit(req.user.id, 'auth.2fa.setup_started', {}, requestIp(req))
  res.json({ secret, otpauthUrl: uri })
})

app.post('/api/auth/2fa/verify', requireAuth, async (req, res) => {
  const { code } = req.body || {}
  if (!req.user.totp_pending_secret) return res.status(400).json({ message: 'Primero inicia la configuración de 2FA.' })
  const result = await verify({ secret: req.user.totp_pending_secret, token: String(code || '') })
  if (!result.valid) return res.status(400).json({ message: 'Código 2FA inválido.' })

  db.prepare('UPDATE users SET totp_secret = ?, totp_pending_secret = NULL, totp_enabled = 1, updated_at = ? WHERE id = ?').run(req.user.totp_pending_secret, new Date().toISOString(), req.user.id)
  audit(req.user.id, 'auth.2fa.enabled', {}, requestIp(req))
  res.json({ enabled: true })
})

app.get('/api/profile', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }))

app.get('/api/cards/requests', requireAuth, (req, res) => {
  const timestamp = new Date().toISOString()
  db.prepare(`
    UPDATE card_requests
    SET card_status = 'active', status = 'approved'
    WHERE user_id = ? AND card_type = 'physical' AND card_status = 'pending'
      AND estimated_ready_at IS NOT NULL AND estimated_ready_at <= ?
  `).run(req.user.id, timestamp)

  const requests = db.prepare(`
    SELECT id, first_name AS firstName, last_name AS lastName, document, phone, email,
      card_type AS cardType, card_kind AS cardKind,
      CASE WHEN card_status = 'active' THEN card_number ELSE NULL END AS cardNumber,
      card_status AS cardStatus, card_limit AS cardLimit, card_locked AS cardLocked,
      estimated_ready_at AS estimatedReadyAt, address, city, department,
      postal_code AS postalCode, status, created_at AS createdAt
    FROM card_requests
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id)
  return res.json({ requests })
})

app.post('/api/cards/requests', requireAuth, (req, res) => {
  const { address, city, department, postalCode } = req.body || {}
  const cardKinds = Array.isArray(req.body?.cardKinds)
    ? [...new Set(req.body.cardKinds)]
    : [req.body?.cardKind]
  const cardTypes = Array.isArray(req.body?.cardTypes)
    ? [...new Set(req.body.cardTypes)]
    : [req.body?.cardType]
  if (!cardKinds.length || cardKinds.some((kind) => !['debit', 'credit'].includes(kind))) {
    return res.status(400).json({ message: 'Selecciona al menos una tarjeta de débito o crédito.' })
  }
  if (!cardTypes.length || cardTypes.some((type) => !['physical', 'digital'].includes(type))) {
    return res.status(400).json({ message: 'Selecciona al menos un formato físico o digital.' })
  }
  if (cardTypes.includes('physical')) {
    if (![address, city, department].every((value) => typeof value === 'string' && value.trim())) {
      return res.status(400).json({ message: 'Completa la dirección, ciudad y departamento de entrega.' })
    }
    if (address.trim().length > 160 || city.trim().length > 80 || department.trim().length > 80) {
      return res.status(400).json({ message: 'Revisa la longitud de los datos de entrega.' })
    }
    if (postalCode != null && (typeof postalCode !== 'string' || postalCode.trim().length > 12)) {
      return res.status(400).json({ message: 'El código postal no puede superar 12 caracteres.' })
    }
  }

  const requestedCards = cardKinds.flatMap((cardKind) => cardTypes.map((cardType) => ({ cardKind, cardType })))
  const existingRequests = db.prepare(`
    SELECT card_kind AS cardKind, card_type AS cardType
    FROM card_requests
    WHERE user_id = ? AND card_status != 'rejected'
  `).all(req.user.id)
  const isAlreadyRequested = ({ cardKind, cardType }) => existingRequests.some((request) =>
    request.cardKind === cardKind && request.cardType === cardType,
  )
  const newRequests = requestedCards.filter((request) => !isAlreadyRequested(request))
  const skippedRequests = requestedCards.filter(isAlreadyRequested)
  if (!newRequests.length) {
    const alreadyRequested = skippedRequests.map(({ cardKind, cardType }) =>
      `${cardKind === 'debit' ? 'débito' : 'crédito'} ${cardType === 'physical' ? 'física' : 'digital'}`,
    )
    return res.json({
      requests: [],
      message: `Ya tienes solicitadas estas opciones: ${alreadyRequested.join(', ')}.`,
    })
  }

  const timestamp = new Date().toISOString()
  const reservedCardNumbers = new Set()
  const cardsToCreate = newRequests.map(({ cardKind, cardType }) => {
    const id = crypto.randomUUID()
    const estimatedReadyAt = cardType === 'physical'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null
    const card = createUniqueRequestedCard(reservedCardNumbers)
    return {
      id,
      cardKind,
      cardType,
      card,
      estimatedReadyAt,
      cardStatus: cardType === 'digital' ? 'active' : 'pending',
      status: cardType === 'digital' ? 'approved' : 'pending',
      cardLimit: cardKind === 'credit' ? 1500000 : 0,
    }
  })
  const createRequests = db.transaction(() => {
    const insertRequest = db.prepare(`
    INSERT INTO card_requests (
      id, user_id, first_name, last_name, document, phone, email, card_type,
      card_kind, card_number, cvv, card_status, card_limit, address, city,
      department, postal_code, estimated_ready_at, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const request of cardsToCreate) {
      insertRequest.run(
        request.id,
        req.user.id,
        req.user.first_name,
        req.user.last_name,
        req.user.document,
        req.user.phone,
        req.user.email,
        request.cardType,
        request.cardKind,
        request.card.cardNumber,
        request.card.cvv,
        request.cardStatus,
        request.cardLimit,
        request.cardType === 'physical' ? address.trim() : null,
        request.cardType === 'physical' ? city.trim() : null,
        request.cardType === 'physical' ? department.trim() : null,
        request.cardType === 'physical' ? (postalCode || '').trim() || null : null,
        request.estimatedReadyAt,
        request.status,
        timestamp,
      )
      audit(req.user.id, 'banking.card.requested', {
        cardRequestId: request.id,
        cardKind: request.cardKind,
        cardType: request.cardType,
      }, requestIp(req))
    }
  })
  createRequests()
  if (pgPool) {
    Promise.all(cardsToCreate.map((request) => pgPool.query(`
      INSERT INTO card_requests (
        id, user_id, first_name, last_name, document, phone, email,
        card_type, card_kind, card_number, cvv, card_status, card_limit,
        address, city, department, postal_code, estimated_ready_at, status, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      ) ON CONFLICT (id) DO NOTHING
    `, [
      request.id, req.user.id, req.user.first_name, req.user.last_name,
      req.user.document, req.user.phone, req.user.email, request.cardType,
      request.cardKind, request.card.cardNumber, request.card.cvv,
      request.cardStatus, request.cardLimit,
      request.cardType === 'physical' ? address.trim() : null,
      request.cardType === 'physical' ? city.trim() : null,
      request.cardType === 'physical' ? department.trim() : null,
      request.cardType === 'physical' ? (postalCode || '').trim() || null : null,
      request.estimatedReadyAt, request.status, timestamp,
    ]))).catch((error) => console.error('Neon card request mirror failed.', error))
  }

  const messages = cardsToCreate.map((request) => request.cardType === 'digital'
    ? `Tarjeta digital de ${request.cardKind === 'debit' ? 'débito' : 'crédito'} activa inmediatamente para usar en Fastbank.`
    : `Tarjeta física de ${request.cardKind === 'debit' ? 'débito' : 'crédito'} lista en aproximadamente 7 días y llegará a ${address.trim()}, ${city.trim()}, ${department.trim()}.`,
  )
  if (skippedRequests.length) {
    messages.push(`Se omitieron opciones que ya tenías solicitadas: ${skippedRequests.map(({ cardKind, cardType }) =>
      `${cardKind === 'debit' ? 'débito' : 'crédito'} ${cardType === 'physical' ? 'física' : 'digital'}`,
    ).join(', ')}.`)
  }
  return res.status(201).json({
    requests: cardsToCreate.map((request) => ({
      id: request.id,
      cardKind: request.cardKind,
      cardType: request.cardType,
      cardStatus: request.cardStatus,
      status: request.status,
      cardLimit: request.cardLimit,
      createdAt: timestamp,
      estimatedReadyAt: request.estimatedReadyAt,
    })),
    message: messages.join(' '),
  })
})

app.get('/api/cards/requests/:cardRequestId/cvv', requireAuth, (req, res) => {
  const card = db.prepare(`
    SELECT cvv FROM card_requests
    WHERE id = ? AND user_id = ? AND card_status = 'active'
  `).get(req.params.cardRequestId, req.user.id)
  if (!card) return res.status(404).json({ message: 'No se encontró una tarjeta activa para esta cuenta.' })
  return res.json({ cvv: card.cvv })
})

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map((user) => {
    const summary = banking.getSummary(user.id)
    const activeLoans = summary.loans.filter((loan) => loan.status === 'active')
    return {
      ...summary.user,
      balance: summary.account.balance,
      savings: summary.account.savings,
      investments: 0,
      pockets: summary.pockets,
      loans: summary.loans,
      transactions: summary.transactions.slice(0, 4),
      creditLimit: summary.creditAssessment.limit,
      debt: activeLoans.reduce((total, loan) => total + loan.remaining_balance, 0),
    }
  })
  res.json({ users })
})

app.get('/api/support/requests', requireAuth, (req, res) => {
  const requests = db.prepare(`
    SELECT id, category, subject, message, status, response, created_at AS createdAt, updated_at AS updatedAt
    FROM support_requests
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.user.id)
  res.json({ requests })
})

app.post('/api/support/requests', requireAuth, (req, res) => {
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : ''
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : ''
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const categories = new Set(['cuenta', 'tarjetas', 'pagos', 'transferencias', 'credito', 'seguridad', 'otro'])
  if (!categories.has(category)) return res.status(400).json({ message: 'Selecciona un tema de ayuda válido.' })
  if (subject.length < 4 || subject.length > 120) {
    return res.status(400).json({ message: 'El asunto debe tener entre 4 y 120 caracteres.' })
  }
  if (message.length < 10 || message.length > 2000) {
    return res.status(400).json({ message: 'Describe el inconveniente en un texto de 10 a 2.000 caracteres.' })
  }

  const timestamp = new Date().toISOString()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO support_requests (id, user_id, category, subject, message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, category, subject, message, timestamp, timestamp)
  if (pgPool) {
    pgPool.query(`
      INSERT INTO support_requests (id, user_id, category, subject, message, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'open',$6,$6)
      ON CONFLICT (id) DO NOTHING
    `, [id, req.user.id, category, subject, message, timestamp]).catch((error) => {
      console.error('Neon support request mirror failed.', error)
    })
  }
  audit(req.user.id, 'support.request.created', { requestId: id, category })
  const request = db.prepare(`
    SELECT id, category, subject, message, status, response, created_at AS createdAt, updated_at AS updatedAt
    FROM support_requests WHERE id = ?
  `).get(id)
  return res.status(201).json({ request })
})

app.get('/api/admin/support/requests', requireAuth, requireAdmin, (_req, res) => {
  const requests = db.prepare(`
    SELECT sr.id, sr.category, sr.subject, sr.message, sr.status, sr.response,
      sr.created_at AS createdAt, sr.updated_at AS updatedAt,
      u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email
    FROM support_requests sr
    JOIN users u ON u.id = sr.user_id
    ORDER BY CASE sr.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, sr.created_at DESC
    LIMIT 100
  `).all()
  res.json({ requests })
})

app.patch('/api/admin/support/requests/:id', requireAuth, requireAdmin, (req, res) => {
  const status = req.body?.status
  const response = typeof req.body?.response === 'string' ? req.body.response.trim() : ''
  if (!['open', 'in_progress', 'resolved'].includes(status)) {
    return res.status(400).json({ message: 'Selecciona un estado válido para el caso.' })
  }
  if (response.length > 2000) return res.status(400).json({ message: 'La respuesta no puede superar 2.000 caracteres.' })
  if (status === 'resolved' && response.length < 2) {
    return res.status(400).json({ message: 'Escribe una respuesta antes de resolver el caso.' })
  }
  const result = db.prepare(`
    UPDATE support_requests SET status = ?, response = ?, updated_at = ?
    WHERE id = ?
  `).run(status, response || null, new Date().toISOString(), req.params.id)
  if (!result.changes) return res.status(404).json({ message: 'No se encontró la solicitud de soporte.' })
  const request = db.prepare(`
    SELECT id, category, subject, message, status, response, created_at AS createdAt, updated_at AS updatedAt
    FROM support_requests WHERE id = ?
  `).get(req.params.id)
  audit(req.user.id, 'support.request.updated', { requestId: req.params.id, status })
  return res.json({ request })
})

app.post('/api/admin/users/:id/password-reset', requireAuth, requireAdmin, async (req, res) => {
  const user = db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(req.params.id)
  if (!user || user.role === 'admin' || user.status !== 'active') {
    return res.status(404).json({ message: 'No se encontró un cliente activo para restablecer.' })
  }
  if (!isSmtpConfigured()) {
    return res.status(503).json({ message: 'El envío de correo no está configurado. Revisa las variables SMTP del archivo .env.' })
  }

  const delivered = await issueCredentialReset(user, req.user.id, 'password')
  if (!delivered) {
    return res.status(502).json({ message: 'No se pudo enviar el correo. Verifica la configuración SMTP e inténtalo de nuevo.' })
  }

  audit(req.user.id, 'auth.password_reset_issued', { targetUserId: user.id }, requestIp(req))
  return res.status(201).json({ message: 'El código de restablecimiento fue enviado al correo registrado.' })
})

app.patch('/api/profile', requireAuth, (req, res) => {
  const { firstName, lastName, phone, email } = req.body || {}
  if (![firstName, lastName, phone, email].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ message: 'Completa todos los datos personales.' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const duplicate = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(normalizedEmail, req.user.id)
  if (duplicate) return res.status(409).json({ message: 'Ese correo ya está registrado.' })

  db.prepare(`
    UPDATE users SET first_name = ?, last_name = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?
  `).run(firstName.trim(), lastName.trim(), phone.trim(), normalizedEmail, new Date().toISOString(), req.user.id)
  const updatedUser = getUser(req.user.id)
  audit(req.user.id, 'profile.updated', { fields: ['firstName', 'lastName', 'phone', 'email'] }, requestIp(req))
  res.json({ user: publicUser(updatedUser) })
})

const banking = registerBankingRoutes({ app, db, audit, publicUser, requireAuth, requireAdmin })

banking.aviator.start()

app.get('/api/transactions', requireAuth, (req, res) => {
  const transactions = db.prepare(`
    SELECT id, type, amount, description, category, status, created_at AS createdAt
    FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.user.id)
  res.json({ transactions })
})

app.get('/api/audit', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT id, action, metadata, ip_address AS ipAddress, created_at AS createdAt
    FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.user.id).map((log) => ({ ...log, metadata: JSON.parse(log.metadata) }))
  res.json({ logs })
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ message: 'Error interno del servidor.' })
})

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  app.listen(port, () => console.log(`Fastbank API listening on http://localhost:${port}`))
}

export { app, db, banking }
