import nodemailer from 'nodemailer'

export const isSmtpConfigured = (env = process.env) =>
  Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM)

export const sendPasswordResetEmail = async ({
  to,
  token,
  expiresAt,
  purpose = 'password',
  env = process.env,
  createTransport = nodemailer.createTransport,
}) => {
  if (!isSmtpConfigured(env)) {
    throw new Error('Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM para enviar correos.')
  }

  const transporter = createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE === 'true',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  })

  const credentialName = purpose === 'pin' ? 'PIN' : 'contraseña'
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: `Código para restablecer tu ${credentialName} de Fastbank`,
    text: `Tu código para restablecer tu ${credentialName} es: ${token}\n\nVence: ${new Date(expiresAt).toLocaleString('es-CO')}.\n\nSi no solicitaste este cambio, ignora este correo.`,
    html: `<p>Recibimos una solicitud para restablecer tu ${credentialName} de Fastbank.</p><p>Tu código de un solo uso es:</p><p style="font-size:20px;font-weight:bold;letter-spacing:2px">${token}</p><p>Vence: ${new Date(expiresAt).toLocaleString('es-CO')}.</p><p>Si no solicitaste este cambio, ignora este correo.</p>`,
  })
}

export const sendRegistrationVerificationEmail = async ({
  to,
  code,
  expiresAt,
  env = process.env,
  createTransport = nodemailer.createTransport,
}) => {
  if (!isSmtpConfigured(env)) {
    throw new Error('Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM para enviar correos.')
  }

  const transporter = createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE === 'true',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  })

  const delivery = await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Verifica tu correo para crear tu cuenta Fastbank',
    text: `Tu código de verificación de Fastbank es: ${code}\n\nVence: ${new Date(expiresAt).toLocaleString('es-CO')}.\n\nSi no solicitaste este código, ignora este correo.`,
    html: `<p>Usa este código para verificar tu correo y continuar con el registro en Fastbank:</p><p style="font-size:20px;font-weight:bold;letter-spacing:2px">${code}</p><p>Vence: ${new Date(expiresAt).toLocaleString('es-CO')}.</p><p>Si no solicitaste este código, ignora este correo.</p>`,
  })

  if (delivery?.rejected?.some((recipient) => recipient.toLowerCase() === to.toLowerCase())) {
    throw new Error('El servidor de correo rechazó la dirección de destino.')
  }
  if (Array.isArray(delivery?.accepted) && !delivery.accepted.some((recipient) => recipient.toLowerCase() === to.toLowerCase())) {
    throw new Error('El servidor de correo no aceptó la dirección de destino.')
  }

  return { accepted: true, messageId: delivery?.messageId }
}
