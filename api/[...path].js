const forwardedHeaders = ['accept', 'authorization', 'content-type', 'idempotency-key']

const requestBody = async (req) => {
  if (req.body === undefined) {
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return chunks.length ? Buffer.concat(chunks) : undefined
  }
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body
  return JSON.stringify(req.body)
}

export default async function proxyApi(req, res) {
  const configuredOrigin = process.env.API_ORIGIN
  let upstreamOrigin
  try {
    upstreamOrigin = new URL(configuredOrigin)
  } catch {
    res.statusCode = 503
    res.end('API_ORIGIN is not configured.')
    return
  }
  if (!['https:', 'http:'].includes(upstreamOrigin.protocol) || upstreamOrigin.username || upstreamOrigin.password) {
    res.statusCode = 503
    res.end('API_ORIGIN is invalid.')
    return
  }

  const requestUrl = new URL(req.url, 'https://vercel.invalid')
  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, upstreamOrigin)
  const headers = new Headers()
  for (const name of forwardedHeaders) {
    const value = req.headers[name]
    if (typeof value === 'string') headers.set(name, value)
  }

  try {
    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await requestBody(req),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    })
    res.statusCode = response.status
    for (const name of ['content-type', 'cache-control']) {
      const value = response.headers.get(name)
      if (value) res.setHeader(name, value)
    }
    res.end(['204', '304'].includes(String(response.status)) ? undefined : Buffer.from(await response.arrayBuffer()))
  } catch {
    res.statusCode = 502
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ message: 'El servicio bancario no está disponible.' }))
  }
}
