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

// Browser-like headers that mail.tm expects (mirrors a real Chrome request)
const MAILTM_HEADERS = {
  'accept': '*/*',
  'accept-language': 'fr-FR,fr;q=0.7',
  'origin': 'https://mail.tm',
  'referer': 'https://mail.tm/',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Brave";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'sec-gpc': '1',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
}

async function proxy(url, opts = {}) {
  // Inject real browser headers only for mail.tm requests
  const isMailTm = url.startsWith('https://api.mail.tm')
  const baseHeaders = isMailTm ? MAILTM_HEADERS : {
    'user-agent': 'Mozilla/5.0 (compatible; elecktemp/1.0)',
    'accept': 'application/json',
  }

  const res = await fetch(url, {
    ...opts,
    headers: {
      ...baseHeaders,
      'content-type': 'application/json',
      ...opts.headers,
    },
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}

function bearer(req) {
  const t = req.headers.authorization?.replace('Bearer ', '')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// ─── mail.tm ──────────────────────────────────────────────────────────────────
app.get('/api/mailtm/domains', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.mailtm.base}/domains`)
    res.status(status).json({ domains: data['hydra:member']?.map(d => d.domain) ?? [] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/mailtm/accounts', async (req, res) => {
  try {
    const { address, password } = req.body
    if (!address || !password) return res.status(400).json({ error: 'address and password required' })
    const { status, data } = await proxy(`${P.mailtm.base}/accounts`, {
      method: 'POST', body: JSON.stringify({ address, password }),
    })
    res.status(status).json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/mailtm/token', async (req, res) => {
  try {
    const { address, password } = req.body
    if (!address || !password) return res.status(400).json({ error: 'address and password required' })
    const { status, data } = await proxy(`${P.mailtm.base}/token`, {
      method: 'POST', body: JSON.stringify({ address, password }),
    })
    res.status(status).json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/mailtm/me', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.mailtm.base}/me`, { headers: bearer(req) })
    res.status(status).json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/mailtm/messages', async (req, res) => {
  try {
    const page = req.query.page || 1
    const { status, data } = await proxy(`${P.mailtm.base}/messages?page=${page}`, { headers: bearer(req) })
    res.status(status).json({ messages: data['hydra:member'] ?? [], total: data['hydra:totalItems'] ?? 0 })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/mailtm/messages/:id', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.mailtm.base}/messages/${req.params.id}`, { headers: bearer(req) })
    res.status(status).json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/mailtm/messages/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const r = await fetch(`${P.mailtm.base}/messages/${req.params.id}`, {
      method: 'DELETE',
      headers: { ...MAILTM_HEADERS, Authorization: `Bearer ${token}` },
    })
    res.status(r.status).json({ deleted: r.status === 204 })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/mailtm/messages/:id/read', async (req, res) => {
  try {
    const { status, data } = await proxy(`${P.mailtm.base}/messages/${req.params.id}`, {
      method: 'PATCH',
      headers: { ...bearer(req), 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ seen: true }),
    })
    res.status(status).json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/mailtm/accounts/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const r = await fetch(`${P.mailtm.base}/accounts/${req.params.id}`, {
      method: 'DELETE',
      headers: { ...MAILTM_HEADERS, Authorization: `Bearer ${token}` },
    })
    res.status(r.status).json({ deleted: r.status === 204 })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/tempmailio/messages/:email', async (req, res) => {
  try {
    const { data } = await proxy(
      `${P.tempmailio.base}/api/v3/email/${encodeURIComponent(req.params.email)}/messages`,
      { headers: bearer(req) }
    )
    const messages = Array.isArray(data) ? data : []
    res.json({ messages, total: messages.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── smailpro (via sonjj.com) ─────────────────────────────────────────────────
async function getSmailproJWT(apiPath, extraParams = '') {
  const targetUrl = `${P.smailpro.base}${apiPath}`
  const payloadReqUrl = `${P.smailpro.payload}?url=${encodeURIComponent(targetUrl)}${extraParams}`
  const { data } = await proxy(payloadReqUrl, {
    headers: { Referer: 'https://smailpro.com/', Origin: 'https://smailpro.com' },
  })
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── System ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.1.0', name: 'elecktemp', providers: Object.keys(P), ts: new Date().toISOString() })
})

app.get('/api/providers/status', async (req, res) => {
  const checks = await Promise.allSettled([
    fetch(`${P.mailtm.base}/domains`, {
      headers: MAILTM_HEADERS,
      signal: AbortSignal.timeout(5000),
    }).then(r => ({ provider: 'mailtm', up: r.ok })),
    fetch(`${P.tempmailio.base}/api/v3/email/new`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ min_name_length: 5, max_name_length: 5 }),
      signal: AbortSignal.timeout(5000),
    }).then(r => ({ provider: 'tempmailio', up: r.ok })),
  ])
  res.json({
    providers: checks.map(c =>
      c.status === 'fulfilled' ? c.value : { provider: 'unknown', up: false }
    ),
  })
})

// ─── Static files (index.html at root, not in /public/) ───────────────────────
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
