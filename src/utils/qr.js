const readField = (source, ...keys) => {
  const entries = Object.entries(source || {})
  for (const key of keys) {
    const match = entries.find(([field]) => field.toLowerCase() === key.toLowerCase())?.[1]
    if (typeof match === 'string' || typeof match === 'number') {
      const value = String(match).trim()
      if (value) return value
    }
  }
  return ''
}

const toRecipient = (source) => {
  const user = source?.user && typeof source.user === 'object' ? source.user : {}
  const recipientData = source?.destinatario && typeof source.destinatario === 'object' ? source.destinatario : {}
  const fields = { ...source, ...user, ...recipientData }
  const recipientId = readField(fields, 'recipientId', 'userId', 'idUsuario', 'id')
  const account = readField(fields, 'cuenta', 'account', 'numeroCuenta', 'accountNumber', 'phone', 'telefono', 'document', 'documento') || recipientId
  const recipient = readField(fields, 'name', 'nombre', 'recipient', 'destinatario') || recipientId

  if (!account) throw new Error('El QR no contiene una cuenta o identificador.')
  return { recipient, account, recipientId }
}

export const parseBankQr = (decodedValue) => {
  const text = String(decodedValue ?? '').trim()
  if (!text) throw new Error('El QR está vacío.')

  if (text.startsWith('{')) {
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('El QR contiene datos JSON inválidos.')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('El contenido del QR no es válido.')
    }
    return toRecipient(payload)
  }

  if (/^(https?:\/\/|fastbank:\/\/)/i.test(text)) {
    let url
    try {
      const normalized = text.replace(/^FASTBANK:\/\//i, 'https://fastbank.local/')
      url = new URL(normalized)
    } catch {
      throw new Error('La dirección del QR no es válida.')
    }

    const parameters = Object.fromEntries(url.searchParams.entries())
    try {
      return toRecipient(parameters)
    } catch (error) {
      const path = url.pathname.split('/').filter(Boolean)
      const isAccountPath = path.length === 2 && ['account', 'cuenta', 'user', 'usuario'].includes(path[0].toLowerCase())
      const fastBankHost = /^fastbank:\/\/([^/?#]+)$/i.exec(text)?.[1]
      const pathId = isAccountPath ? path[1] : fastBankHost && fastBankHost.toLowerCase() !== 'pay' ? fastBankHost : ''
      if (pathId) {
        return { recipient: pathId, account: pathId, recipientId: pathId }
      }
      throw error
    }
  }

  return { recipient: '', account: text, recipientId: '' }
}
