import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;
const API_URL = 'https://api.mail.tm';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessions in memory: sessionId -> { address, token, password, createdAt }
const sessions = new Map();

// Cleanup sessions older than 24h every 30min
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > 86400000) sessions.delete(id);
  }
}, 1800000);

// ─── Helper ────────────────────────────────────────────────────────────────

function mailClient(token) {
  return axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 12000,
  });
}

function handleError(res, e, defaultMsg) {
  console.error(e?.response?.data || e.message);
  const status = e?.response?.status || 500;
  if (status === 401) return res.status(401).json({ error: 'Session expirée, veuillez créer une nouvelle adresse' });
  if (status === 429) return res.status(429).json({ error: 'Trop de requêtes, veuillez patienter' });
  res.status(500).json({ error: defaultMsg });
}

// ─── Routes ────────────────────────────────────────────────────────────────

// GET /api/domains
app.get('/api/domains', async (req, res) => {
  try {
    const r = await axios.get(`${API_URL}/domains`, { timeout: 8000 });
    res.json(r.data['hydra:member'].filter(d => d.isActive));
  } catch (e) {
    handleError(res, e, 'Impossible de récupérer les domaines');
  }
});

// POST /api/accounts — Crée un nouveau compte mail (supporte ?prefix=xxx)
app.post('/api/accounts', async (req, res) => {
  try {
    const domainsRes = await axios.get(`${API_URL}/domains`, { timeout: 8000 });
    const domains = domainsRes.data['hydra:member'].filter(d => d.isActive);
    if (!domains.length) return res.status(500).json({ error: 'Aucun domaine disponible' });

    // Support domain selection
    let domain = domains[0].domain;
    if (req.body.domain) {
      const found = domains.find(d => d.domain === req.body.domain);
      if (found) domain = found.domain;
    }

    // Support custom prefix (alphanum only, 3-20 chars)
    let prefix = uuidv4().replace(/-/g, '').substring(0, 12);
    if (req.body.prefix) {
      const clean = req.body.prefix.replace(/[^a-z0-9._-]/gi, '').toLowerCase();
      if (clean.length >= 3 && clean.length <= 20) prefix = clean;
      else return res.status(400).json({ error: 'Le préfixe doit faire entre 3 et 20 caractères (lettres, chiffres, . - _)' });
    }

    const address = `${prefix}@${domain}`;
    const password = uuidv4();

    await axios.post(`${API_URL}/accounts`, { address, password }, { timeout: 10000 });
    const tokenRes = await axios.post(`${API_URL}/token`, { address, password }, { timeout: 10000 });
    const token = tokenRes.data.token;

    const sessionId = uuidv4();
    sessions.set(sessionId, { address, token, password, createdAt: Date.now() });

    res.json({ sessionId, address, domain });
  } catch (e) {
    if (e?.response?.status === 422) {
      return res.status(422).json({ error: 'Cette adresse est déjà prise, essayez un autre préfixe' });
    }
    handleError(res, e, 'Erreur lors de la création du compte');
  }
});

// GET /api/session?sessionId=xxx — Valide et retourne infos session
app.get('/api/session', async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ valid: false, error: 'Session introuvable' });
  // Quick validation with mail.tm
  try {
    await mailClient(session.token).get('/me');
    res.json({ valid: true, address: session.address });
  } catch (e) {
    sessions.delete(sessionId);
    res.status(401).json({ valid: false, error: 'Session expirée' });
  }
});

// GET /api/messages?sessionId=xxx
app.get('/api/messages', async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  try {
    const client = mailClient(session.token);
    const r = await client.get('/messages?page=1');
    const messages = r.data['hydra:member'].map(m => ({
      id: m.id,
      from: m.from?.address || m.from?.name || '?',
      fromName: m.from?.name || '',
      subject: m.subject || '(Aucun sujet)',
      intro: m.intro || '',
      seen: m.seen,
      hasAttachments: m.hasAttachments || false,
      size: m.size || 0,
      createdAt: m.createdAt,
    }));
    res.json(messages);
  } catch (e) {
    handleError(res, e, 'Erreur lors de la récupération des messages');
  }
});

// GET /api/messages/:id?sessionId=xxx
app.get('/api/messages/:id', async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  try {
    const client = mailClient(session.token);
    const r = await client.get(`/messages/${req.params.id}`);
    const msg = r.data;
    res.json({
      id: msg.id,
      from: msg.from?.address || '?',
      fromName: msg.from?.name || '',
      to: (msg.to || []).map(t => t.address).join(', ') || '?',
      subject: msg.subject || '(Aucun sujet)',
      text: msg.text || '',
      html: msg.html || [],
      seen: msg.seen,
      hasAttachments: msg.hasAttachments || false,
      attachments: (msg.attachments || []).map(a => ({
        id: a.id, filename: a.filename, contentType: a.contentType, size: a.size
      })),
      createdAt: msg.createdAt,
    });
  } catch (e) {
    handleError(res, e, 'Erreur lors de la récupération du message');
  }
});

// DELETE /api/messages/:id?sessionId=xxx
app.delete('/api/messages/:id', async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  try {
    await mailClient(session.token).delete(`/messages/${req.params.id}`);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e, 'Erreur lors de la suppression du message');
  }
});

// PATCH /api/messages/:id?sessionId=xxx — Marquer lu/non lu
app.patch('/api/messages/:id', async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  try {
    await mailClient(session.token).patch(`/messages/${req.params.id}`, { seen: req.body.seen });
    res.json({ success: true });
  } catch (e) {
    handleError(res, e, 'Erreur lors de la mise à jour du message');
  }
});

// DELETE /api/accounts?sessionId=xxx
app.delete('/api/accounts', async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  try {
    const client = mailClient(session.token);
    const meRes = await client.get('/me');
    await client.delete(`/accounts/${meRes.data.id}`);
  } catch (e) {
    console.error('Delete account error:', e?.response?.data || e.message);
  } finally {
    sessions.delete(sessionId);
    res.json({ success: true });
  }
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅  ElekTemp démarré sur http://localhost:${PORT}\n`);
});
