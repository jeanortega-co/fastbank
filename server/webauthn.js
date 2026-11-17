import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'

const now = () => new Date()
const nowIso = () => now().toISOString()
const challengeLifetimeMs = 5 * 60 * 1000

class WebAuthnError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const requestContext = (req, allowedOrigins) => {
  const requestOrigin = req.get('origin')
  let refererOrigin = ''
  try {
    refererOrigin = req.get('referer') ? new URL(req.get('referer')).origin : ''
  } catch {
    refererOrigin = ''
  }
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN?.trim()
  const origin = (refererOrigin && allowedOrigins.has(refererOrigin) ? refererOrigin : '')
    || (requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : '')
    || configuredOrigin
  if (!origin || !allowedOrigins.has(origin)) {
    throw new WebAuthnError('El origen de esta página no está autorizado para passkeys.', 403)
  }

  let pageUrl
  try {
    pageUrl = new URL(origin)
  } catch {
    throw new WebAuthnError('No se pudo validar el dominio de la página.', 400)
  }

  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(pageUrl.hostname)
  if (pageUrl.protocol !== 'https:' && !isLocalhost) {
    throw new WebAuthnError('Las passkeys requieren HTTPS. En desarrollo solo localhost es seguro.', 400)
  }

  const configuredRpID = process.env.WEBAUTHN_RP_ID?.trim()
  const configuredRpIDMatchesOrigin = configuredRpID
    && (pageUrl.hostname === configuredRpID || pageUrl.hostname.endsWith(`.${configuredRpID}`))
  const rpID = configuredRpIDMatchesOrigin ? configuredRpID : pageUrl.hostname

  return { origin, rpID }
}

export const registerWebAuthnRoutes = ({ app, db, audit, publicUser, issueToken, requireAuth, allowedOrigins }) => {
  const saveChallenge = ({ userId = null, ceremony, challenge, rpID, origin }) => {
    const id = crypto.randomUUID()
    const createdAt = now()
    const expiresAt = new Date(createdAt.getTime() + challengeLifetimeMs).toISOString()
    db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').run(createdAt.toISOString())
    db.prepare(`
      INSERT INTO webauthn_challenges (id, user_id, ceremony, challenge, rp_id, origin, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, ceremony, challenge, rpID, origin, expiresAt, createdAt.toISOString())
    return id
  }

  const getChallenge = (id, ceremony, userId = null) => {
    const challenge = db.prepare(`
      SELECT * FROM webauthn_challenges
      WHERE id = ? AND ceremony = ? AND (? IS NULL OR user_id = ?)
    `).get(id, ceremony, userId, userId)
    if (!challenge || Date.parse(challenge.expires_at) <= Date.now()) {
      throw new WebAuthnError('El reto de passkey expiró. Inténtalo de nuevo.', 410)
    }
    return challenge
  }

  const currentCredentials = (userId) => db.prepare(`
    SELECT credential_id AS id, transports FROM webauthn_credentials
    WHERE user_id = ? ORDER BY created_at
  `).all(userId).map((credential) => ({
    id: credential.id,
    transports: JSON.parse(credential.transports || '[]'),
  }))

  app.get('/api/auth/passkeys', requireAuth, (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = ?').get(req.user.id).count
    res.json({ count, configured: count > 0 })
  })

  app.post('/api/auth/passkeys/registration-options', requireAuth, async (req, res) => {
    try {
      const { origin, rpID } = requestContext(req, allowedOrigins)
      const options = await generateRegistrationOptions({
        rpName: 'FastBank',
        rpID,
        userName: req.user.email,
        userDisplayName: `${req.user.first_name} ${req.user.last_name}`,
        userID: new TextEncoder().encode(req.user.id),
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        excludeCredentials: currentCredentials(req.user.id),
      })
      const challengeId = saveChallenge({
        userId: req.user.id,
        ceremony: 'registration',
        challenge: options.challenge,
        rpID,
        origin,
      })
      res.json({ challengeId, options })
    } catch (error) {
      res.status(error instanceof WebAuthnError ? error.status : 500).json({
        message: error instanceof WebAuthnError ? error.message : 'No se pudieron preparar las passkeys.',
      })
    }
  })

  app.post('/api/auth/passkeys/registration-verify', requireAuth, async (req, res) => {
    const { challengeId, response } = req.body || {}
    try {
      if (!challengeId || !response) throw new WebAuthnError('Falta la respuesta de registro.')
      const challenge = getChallenge(challengeId, 'registration', req.user.id)
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        requireUserVerification: true,
      })
      if (!verification.verified || !verification.registrationInfo?.credential) {
        throw new WebAuthnError('El dispositivo no pudo verificar la passkey.', 401)
      }

      const credential = verification.registrationInfo.credential
      const createdAt = nowIso()
      const finishRegistration = db.transaction(() => {
        if (!getChallenge(challengeId, 'registration', req.user.id)) throw new WebAuthnError('El reto ya fue utilizado.', 409)
        db.prepare(`
          INSERT INTO webauthn_credentials (credential_id, user_id, public_key, counter, transports, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          credential.id,
          req.user.id,
          Buffer.from(credential.publicKey).toString('base64url'),
          credential.counter,
          JSON.stringify(credential.transports || []),
          createdAt,
        )
        db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(challengeId)
        audit(req.user.id, 'auth.passkey.registered', { credentialId: credential.id }, req.ip)
      })
      finishRegistration()
      res.status(201).json({ configured: true })
    } catch (error) {
      const isDuplicate = error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      res.status(isDuplicate ? 409 : error instanceof WebAuthnError ? error.status : 400).json({
        message: isDuplicate ? 'Esta passkey ya está registrada.' : error instanceof WebAuthnError ? error.message : 'No se pudo verificar la passkey.',
      })
    }
  })

  app.post('/api/auth/passkeys/authentication-options', async (req, res) => {
    try {
      const { origin, rpID } = requestContext(req, allowedOrigins)
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
      })
      const challengeId = saveChallenge({
        ceremony: 'authentication',
        challenge: options.challenge,
        rpID,
        origin,
      })
      res.json({ challengeId, options })
    } catch (error) {
      res.status(error instanceof WebAuthnError ? error.status : 500).json({
        message: error instanceof WebAuthnError ? error.message : 'No se pudo iniciar el acceso con passkey.',
      })
    }
  })

  app.post('/api/auth/passkeys/authentication-verify', async (req, res) => {
    const { challengeId, response } = req.body || {}
    try {
      if (!challengeId || !response?.id) throw new WebAuthnError('Falta la respuesta de autenticación.')
      const challenge = getChallenge(challengeId, 'authentication')
      const credential = db.prepare(`
        SELECT credential_id, user_id, public_key, counter, transports
        FROM webauthn_credentials WHERE credential_id = ?
      `).get(response.id)
      if (!credential) throw new WebAuthnError('No se encontró esa passkey. Regístrala desde Seguridad.', 401)

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        requireUserVerification: true,
        credential: {
          id: credential.credential_id,
          publicKey: Buffer.from(credential.public_key, 'base64url'),
          counter: credential.counter,
          transports: JSON.parse(credential.transports || '[]'),
        },
      })
      if (!verification.verified || !verification.authenticationInfo.userVerified) {
        throw new WebAuthnError('La verificación local del usuario no se completó.', 401)
      }

      const user = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(credential.user_id)
      if (!user) throw new WebAuthnError('La cuenta no está activa.', 401)
      const { newCounter } = verification.authenticationInfo
      const finishAuthentication = db.transaction(() => {
        if (!getChallenge(challengeId, 'authentication')) throw new WebAuthnError('El reto ya fue utilizado.', 409)
        db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?').run(newCounter, credential.credential_id)
        db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(challengeId)
        audit(user.id, 'auth.passkey.login', { credentialId: credential.credential_id }, req.ip)
      })
      finishAuthentication()
      res.json({ token: issueToken(user), user: publicUser(user) })
    } catch (error) {
      res.status(error instanceof WebAuthnError ? error.status : 401).json({
        message: error instanceof WebAuthnError ? error.message : 'No se pudo validar la passkey. Inténtalo de nuevo.',
      })
    }
  })
}
