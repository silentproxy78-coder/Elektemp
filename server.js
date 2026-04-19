import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// ─── Providers ────────────────────────────────────────────────────────────────
const P = {
  mailtm:    { base: 'https://api.mail.tm',               name: 'mail.tm' },
  tempmailio:{ base: 'https://api.internal.temp-mail.io', name: 'temp-mail.io' },
  smailpro:  { base: 'https://api.sonjj.com', payload: 'https://smailpro.com/app/payload', name: 'smailpro' },
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json())

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAILTM_HEADERS = {
  'accept': 'application/json, */*',
  'accept-language': 'fr-FR,fr;q=0.7',
  'origin': 'https://mail.tm',
  'referer': 'https://mail.tm/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // sec-fetch-* headers removed: browsers set them automatically, they cannot be
  // legitimately spoofed from a server and may cause mail.tm to reject datacenter IPs.
}

const PROXY_TIMEOUT_MS = 9_000   // stay under Vercel's 10 s default function limit

async function proxy(url, opts = {}) {
  const isMailTm = url.startsWith('https://api.mail.tm')
  const baseHeaders = isMailTm ? MAILTM_HEADERS : {
    'user-agent': 'Mozilla/5.0 (compatible; elecktemp/2.0)',
    'accept': 'application/json',
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        ...baseHeaders,
        'content-type': 'application/json',
        ...opts.headers,
      },
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { status: res.status, ok: res.ok, data }
  } finally {
    clearTimeout(timer)
  }
}

function bearer(req) {
  const t = req.headers.authorization?.replace('Bearer ', '')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// ─── mail.tm ──────────────────────────────────────────────────────────────────
app.get('/api/mailtm/domains', async (req, res) => {
  try {
    const { status, ok, data } = await proxy(`${P.mailtm.base}/domains`)
    if (!ok) {
      // Upstream error (mail.tm blocking datacenter IPs, rate-limit, etc.)
      return res.status(503).json({
        error: `mail.tm indisponible (upstream ${status})`,
        domains: [],
      })
    }
    res.json({ domains: data['hydra:member']?.map(d => d.domain) ?? [] })
  } catch (e) {
    res.status(503).json({
      error: e.name === 'AbortError' ? 'mail.tm timeout' : e.message,
      domains: [],
    })
  }
})

app.post('/api/mailtm/accounts', async (req, res) => {
  try {
    const { address, password } = req.body
    if (!address || !password) return res.status(400).json({ error: 'address and password required' })
    const { status, data } = await proxy(`${P.mailtm.base}/accounts`, {
      method: 'POST', body: JSON.stringify({ address, password }),
    })
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'mail.tm timeout' : e.message })
  }
})

app.post('/api/mailtm/token', async (req, res) => {
  try {
    const { address, password } = req.body
    if (!address || !password) return res.status(400).json({ error: 'address and password required' })
    const { status, data } = await proxy(`${P.mailtm.base}/token`, {
      method: 'POST', body: JSON.stringify({ address, password }),
    })
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'mail.tm timeout' : e.message })
  }
})

app.get('/api/mailtm/me', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.mailtm.base}/me`, { headers: bearer(req) })
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'mail.tm timeout' : e.message })
  }
})

app.get('/api/mailtm/messages', async (req, res) => {
  try {
    const page = req.query.page || 1
    const { status, ok, data } = await proxy(
      `${P.mailtm.base}/messages?page=${page}`,
      { headers: bearer(req) }
    )
    if (!ok) return res.status(status).json({
      error: data?.['hydra:description'] || 'Upstream error',
      messages: [], total: 0,
    })
    res.json({ messages: data['hydra:member'] ?? [], total: data['hydra:totalItems'] ?? 0 })
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'mail.tm timeout' : e.message, messages: [], total: 0 })
  }
})

app.get('/api/mailtm/messages/:id', async (req, res) => {
  try {
    const { status, data } = await proxy(
      `${P.mailtm.base}/messages/${req.params.id}`,
      { headers: bearer(req) }
    )
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'mail.tm timeout' : e.message })
  }
})

app.delete('/api/mailtm/messages/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
    try {
      const r = await fetch(`${P.mailtm.base}/messages/${req.params.id}`, {
        method: 'DELETE',
        signal: controller.signal,
        headers: { ...MAILTM_HEADERS, Authorization: `Bearer ${token}` },
      })
      res.status(r.status).json({ deleted: r.status === 204 })
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'timeout' : e.message })
  }
})

app.patch('/api/mailtm/messages/:id/read', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.mailtm.base}/messages/${req.params.id}`, {
      method: 'PATCH',
      headers: { ...bearer(req), 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ seen: true }),
    })
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'timeout' : e.message })
  }
})

app.delete('/api/mailtm/accounts/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
    try {
      const r = await fetch(`${P.mailtm.base}/accounts/${req.params.id}`, {
        method: 'DELETE',
        signal: controller.signal,
        headers: { ...MAILTM_HEADERS, Authorization: `Bearer ${token}` },
      })
      res.status(r.status).json({ deleted: r.status === 204 })
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'timeout' : e.message })
  }
})

// ─── temp-mail.io ─────────────────────────────────────────────────────────────
app.post('/api/tempmailio/new', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.tempmailio.base}/api/v3/email/new`, {
      method: 'POST',
      body: JSON.stringify({
        min_name_length: req.body?.min_name_length ?? 10,
        max_name_length: req.body?.max_name_length ?? 12,
      }),
    })
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'temp-mail.io timeout' : e.message })
  }
})

app.get('/api/tempmailio/messages/:email', async (req, res) => {
  try {
    const { status, ok, data } = await proxy(
      `${P.tempmailio.base}/api/v3/email/${encodeURIComponent(req.params.email)}/messages`,
      { headers: bearer(req) }
    )
    if (!ok) return res.status(status).json({ error: 'Upstream error', messages: [], total: 0 })
    const messages = Array.isArray(data) ? data : []
    res.json({ messages, total: messages.length })
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'temp-mail.io timeout' : e.message, messages: [], total: 0 })
  }
})

// ─── smailpro (via sonjj.com) ─────────────────────────────────────────────────
async function getSmailproJWT(apiPath, extraParams = '') {
  const targetUrl = `${P.smailpro.base}${apiPath}`
  const payloadReqUrl = `${P.smailpro.payload}?url=${encodeURIComponent(targetUrl)}${extraParams}`
  const { ok, data } = await proxy(payloadReqUrl, {
    headers: { Referer: 'https://smailpro.com/', Origin: 'https://smailpro.com' },
  })
  if (!ok) return null
  return data.raw || (typeof data === 'string' ? data : null)
}

app.post('/api/smailpro/new', async (req, res) => {
  try {
    const jwt = await getSmailproJWT('/v1/temp_email/create')
    if (!jwt) return res.status(502).json({ error: 'Could not get smailpro token' })
    const { status, data } = await proxy(
      `${P.smailpro.base}/v1/temp_email/create?payload=${encodeURIComponent(jwt)}`,
      { headers: { Referer: 'https://smailpro.com/' } }
    )
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'smailpro timeout' : e.message })
  }
})

app.get('/api/smailpro/messages/:email', async (req, res) => {
  try {
    const email = req.params.email
    const jwt = await getSmailproJWT('/v1/temp_email/inbox', `&email=${encodeURIComponent(email)}`)
    if (!jwt) return res.status(502).json({ error: 'Could not get smailpro token' })
    const { status, data } = await proxy(
      `${P.smailpro.base}/v1/temp_email/inbox?payload=${encodeURIComponent(jwt)}`,
      { headers: { Referer: 'https://smailpro.com/' } }
    )
    const messages = data.messages || []
    res.status(status).json({ messages, total: messages.length })
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'smailpro timeout' : e.message, messages: [], total: 0 })
  }
})

app.get('/api/smailpro/message/:email/:mid', async (req, res) => {
  try {
    const { email, mid } = req.params
    const jwt = await getSmailproJWT(
      '/v1/temp_email/message',
      `&email=${encodeURIComponent(email)}&mid=${encodeURIComponent(mid)}`
    )
    if (!jwt) return res.status(502).json({ error: 'Could not get smailpro token' })
    const { status, data } = await proxy(
      `${P.smailpro.base}/v1/temp_email/message?payload=${encodeURIComponent(jwt)}`,
      { headers: { Referer: 'https://smailpro.com/' } }
    )
    res.status(status).json(data)
  } catch (e) {
    res.status(503).json({ error: e.name === 'AbortError' ? 'smailpro timeout' : e.message })
  }
})

// ─── System ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.2.0',
    name: 'elecktemp',
    providers: Object.keys(P),
    ts: new Date().toISOString(),
  })
})

app.get('/api/providers/status', async (req, res) => {
  const checks = await Promise.allSettled([
    fetch(`${P.mailtm.base}/domains`, {
      headers: MAILTM_HEADERS,
      signal: AbortSignal.timeout(5000),
    }).then(r => ({ provider: 'mailtm', up: r.ok, status: r.status })),
    fetch(`${P.tempmailio.base}/api/v3/email/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ min_name_length: 5, max_name_length: 5 }),
      signal: AbortSignal.timeout(5000),
    }).then(r => ({ provider: 'tempmailio', up: r.ok, status: r.status })),
  ])
  res.json({
    providers: checks.map(c =>
      c.status === 'fulfilled'
        ? c.value
        : { provider: 'unknown', up: false, error: c.reason?.message }
    ),
  })
})

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(__dirname))

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// ─── Start ────────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`elecktemp → http://localhost:${PORT}`)
  })
}

export default app
