import express from 'express';
import session from 'cookie-session';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { Storage } from './storage.js';
import { AIService } from './ai-service.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || 'https://notes.oussamma.tn').replace(/\/$/, '');

// =============================================================================
// CONFIGURATION FOURNISSEUR SSO (OIDC)
// =============================================================================
const SSO_BASE_URL = (process.env.SSO_BASE_URL || 'https://sso-a.oussamma.tn').replace(/\/$/, '');
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || 'client_notes_app';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || 'sec_notes_platform_secret_2026';
const SSO_REDIRECT_URI = process.env.SSO_REDIRECT_URI || `${APP_URL}/auth/callback`;
const SSO_SCOPES = process.env.SSO_SCOPES || 'openid profile email';

const SSO_AUTH_ENDPOINT = `${SSO_BASE_URL}/oauth/authorize`;
const SSO_TOKEN_ENDPOINT = `${SSO_BASE_URL}/oauth/token`;
const SSO_USERINFO_ENDPOINT = `${SSO_BASE_URL}/oauth/userinfo`;
const SSO_LOGOUT_ENDPOINT = `${SSO_BASE_URL}/oauth/logout`;

const SECRET_SIGN_KEY = process.env.SESSION_SECRET || 'notes-oussamma-super-secret-key-2026-prod';

// =============================================================================
// MIDDLEWARES DE BASE & PROXY COOLIFY
// =============================================================================
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'notes_session',
  keys: [SECRET_SIGN_KEY],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
}));

// =============================================================================
// HELPER PKCE & ÉTAT OIDC
// =============================================================================
function generateOidcStateAndPKCE() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', SECRET_SIGN_KEY).update(`state:${nonce}`).digest('hex');
  const state = `${nonce}.${signature}`;
  const code_verifier = crypto.createHmac('sha256', SECRET_SIGN_KEY).update(`pkce:${nonce}`).digest('base64url').substring(0, 64);
  const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
  return { state, code_verifier, code_challenge };
}

function verifyOidcState(stateParam, sessionState) {
  if (stateParam && typeof stateParam === 'string') {
    const [nonce, signature] = stateParam.split('.');
    if (nonce && signature) {
      const expectedSignature = crypto.createHmac('sha256', SECRET_SIGN_KEY).update(`state:${nonce}`).digest('hex');
      try {
        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expectedSignature, 'hex');
        if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
          const derivedVerifier = crypto.createHmac('sha256', SECRET_SIGN_KEY).update(`pkce:${nonce}`).digest('base64url').substring(0, 64);
          return { valid: true, derivedVerifier };
        }
      } catch (e) {}
    }
  }
  if (sessionState && stateParam === sessionState) {
    return { valid: true };
  }
  return null;
}

function getUserId(req) {
  return req.session?.user?.id || req.session?.user?.email || 'default_user';
}

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Authentification SSO requise pour accéder à vos notes.',
      loginUrl: '/auth/login'
    });
  }
  next();
}

// =============================================================================
// HEALTHCHECK
// =============================================================================
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    app: 'notes.oussamma.tn',
    sso: SSO_BASE_URL
  });
});

// =============================================================================
// AUTHENTIFICATION SSO (OIDC)
// =============================================================================
app.get('/auth/login', (req, res) => {
  const { state, code_verifier, code_challenge } = generateOidcStateAndPKCE();
  req.session.pkce_code_verifier = code_verifier;
  req.session.oauth_state = state;

  const authUrl = new URL(SSO_AUTH_ENDPOINT);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', SSO_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', SSO_REDIRECT_URI);
  authUrl.searchParams.set('scope', SSO_SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', code_challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  res.redirect(authUrl.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.warn('Erreur SSO retournée:', error, error_description);
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code) {
    return res.redirect('/?auth_error=code_manquant');
  }

  const stateCheck = verifyOidcState(state, req.session?.oauth_state);
  const code_verifier = req.session?.pkce_code_verifier || stateCheck?.derivedVerifier || '';

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SSO_CLIENT_ID,
      client_secret: SSO_CLIENT_SECRET,
      code: code.toString(),
      redirect_uri: SSO_REDIRECT_URI,
      code_verifier: code_verifier,
    });

    const tokenRes = await fetch(SSO_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: tokenParams,
    });

    if (!tokenRes.ok) {
      console.error('Échec échange token:', tokenRes.status, await tokenRes.text());
      return res.redirect('/?auth_error=echange_token_echoue');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch(SSO_USERINFO_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (userRes.ok) {
      const userInfo = await userRes.json();
      req.session.user = {
        id: userInfo.sub || userInfo.id,
        email: userInfo.email,
        name: userInfo.name || userInfo.preferred_username || userInfo.email.split('@')[0],
        avatar_url: userInfo.picture || userInfo.avatar_url,
        roles: userInfo.roles || []
      };
      req.session.accessToken = accessToken;
    }

    res.redirect('/?logged_in=1');
  } catch (err) {
    console.error('Erreur traitement callback SSO:', err);
    res.redirect('/?auth_error=erreur_interne');
  }
});

app.get('/api/auth/me', (req, res) => {
  res.json({
    authenticated: !!req.session?.user,
    user: req.session?.user || null,
    ssoBaseUrl: SSO_BASE_URL
  });
});

app.get('/auth/logout', (req, res) => {
  req.session = null;
  res.redirect(`${SSO_LOGOUT_ENDPOINT}?post_logout_redirect_uri=${encodeURIComponent(APP_URL)}`);
});

// =============================================================================
// API PARTAGE PUBLIC (LECTURE SEULE SANS AUTH)
// =============================================================================
app.get('/api/public/notes/:token', (req, res) => {
  const shared = Storage.getNoteByShareToken(req.params.token);
  if (!shared) {
    return res.status(404).json({ error: 'Ce lien de partage est introuvable ou a été révoqué.' });
  }
  res.json(shared);
});

// =============================================================================
// API DOSSIERS (PROTÉGÉES SSO)
// =============================================================================
app.get('/api/folders', requireAuth, (req, res) => {
  const userId = getUserId(req);
  res.json(Storage.getFolders(userId));
});

app.post('/api/folders', requireAuth, (req, res) => {
  try {
    const userId = getUserId(req);
    const folder = Storage.saveFolder(userId, req.body);
    res.status(201).json(folder);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/folders/:id', requireAuth, (req, res) => {
  const userId = getUserId(req);
  const folders = Storage.deleteFolder(userId, req.params.id);
  res.json({ success: true, folders });
});

// =============================================================================
// API NOTES, CARTES & KANBAN (PROTÉGÉES SSO)
// =============================================================================
app.get('/api/notes', requireAuth, (req, res) => {
  const userId = getUserId(req);
  const { q, folderId, tag, archived, pinned, kanbanStatus } = req.query;
  let notes = Storage.getNotes(userId);

  if (archived === 'true') {
    notes = notes.filter(n => n.archived);
  } else if (archived !== 'all') {
    notes = notes.filter(n => !n.archived);
  }

  if (pinned === 'true') {
    notes = notes.filter(n => n.pinned);
  }

  if (folderId && folderId !== 'all') {
    notes = notes.filter(n => n.folderId === folderId);
  }

  if (tag && tag !== 'all') {
    notes = notes.filter(n => (n.tags || []).some(t => t.toLowerCase() === tag.toLowerCase()));
  }

  if (kanbanStatus && kanbanStatus !== 'all') {
    notes = notes.filter(n => n.kanbanStatus === kanbanStatus);
  }

  if (q && q.trim()) {
    const query = q.trim().toLowerCase();
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(query) ||
      (n.content || '').toLowerCase().includes(query) ||
      (n.tags || []).some(t => t.toLowerCase().includes(query)) ||
      (n.checklist || []).some(c => c.text.toLowerCase().includes(query))
    );
  }

  res.json(notes);
});

app.get('/api/notes/:id', requireAuth, (req, res) => {
  const userId = getUserId(req);
  const note = Storage.getNoteById(userId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note introuvable' });
  res.json(note);
});

app.post('/api/notes', requireAuth, (req, res) => {
  try {
    const userId = getUserId(req);
    const saved = Storage.saveNote(userId, req.body);
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/notes/:id', requireAuth, (req, res) => {
  try {
    const userId = getUserId(req);
    const saved = Storage.saveNote(userId, { ...req.body, id: req.params.id });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const userId = getUserId(req);
  Storage.deleteNote(userId, req.params.id);
  res.json({ success: true });
});

// Basculer le partage public d'une note
app.post('/api/notes/:id/share', requireAuth, (req, res) => {
  try {
    const userId = getUserId(req);
    const { enable } = req.body;
    const note = Storage.toggleShareNote(userId, req.params.id, Boolean(enable));
    const shareUrl = note.isPublic && note.shareToken ? `${APP_URL}/?share=${note.shareToken}` : null;
    res.json({ note, shareUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Déplacer une note dans le Kanban ou changer sa priorité
app.post('/api/notes/:id/kanban', requireAuth, (req, res) => {
  try {
    const userId = getUserId(req);
    const note = Storage.getNoteById(userId, req.params.id);
    if (!note) return res.status(404).json({ error: 'Note introuvable' });

    const { kanbanStatus, priority } = req.body;
    const updated = Storage.saveNote(userId, {
      ...note,
      kanbanStatus: kanbanStatus || note.kanbanStatus,
      priority: priority || note.priority
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =============================================================================
// API INTELLIGENCE ARTIFICIELLE (ai.oussamma.tn)
// =============================================================================

// 1. Assistant d'écriture (résumer, corriger, reformuler, traduire, continuer, plan d'action)
app.post('/api/ai/assist', requireAuth, async (req, res) => {
  try {
    const { action, content, title, targetLang, customPrompt } = req.body;
    const data = await AIService.assistWriting({ action, content, title, targetLang, customPrompt });
    res.json(data);
  } catch (err) {
    console.error('Erreur AI Assist:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Auto-organisation : génération de titre, tags, dossier, priorité et extraction de tâches
app.post('/api/ai/auto-organize', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const folders = Storage.getFolders(userId);
    const { title, content } = req.body;
    const organized = await AIService.autoOrganizeAndExtractTasks({ title, content, folders });
    res.json(organized);
  } catch (err) {
    console.error('Erreur AI Auto-Organize:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Dictée vocale -> Structuration automatique en note propre
app.post('/api/ai/voice-structure', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const folders = Storage.getFolders(userId);
    const { transcript, lang, saveImmediately } = req.body;
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcription vocale vide' });
    }

    const structured = await AIService.structureVoiceTranscript({ transcript, lang, folders });

    if (saveImmediately) {
      const saved = Storage.saveNote(userId, structured);
      return res.json({ note: saved, saved: true });
    }
    res.json({ note: structured, saved: false });
  } catch (err) {
    console.error('Erreur AI Voice Structure:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Générer une nouvelle note complète à partir d'un prompt IA
app.post('/api/ai/generate-note', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const folders = Storage.getFolders(userId);
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Sujet ou prompt requis' });
    }

    const generated = await AIService.generateNoteFromPrompt({ prompt, folders });
    const saved = Storage.saveNote(userId, generated);
    res.json(saved);
  } catch (err) {
    console.error('Erreur AI Generate Note:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Recherche sémantique dans les notes
app.post('/api/ai/search', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Requête de recherche requise' });
    }
    const allNotes = Storage.getNotes(userId).filter(n => !n.archived);
    const result = await AIService.semanticSearch({ query, allNotes });
    res.json(result);
  } catch (err) {
    console.error('Erreur AI Semantic Search:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Chat avec mes notes (Cortex IA Second Brain)
app.get('/api/chat', requireAuth, (req, res) => {
  const userId = getUserId(req);
  res.json(Storage.getChatHistory(userId));
});

app.delete('/api/chat', requireAuth, (req, res) => {
  const userId = getUserId(req);
  res.json(Storage.clearChatHistory(userId));
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { message, lang } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message requis' });
    }

    const history = Storage.getChatHistory(userId);
    const allNotes = Storage.getNotes(userId).filter(n => !n.archived);
    const folders = Storage.getFolders(userId);

    const userMsg = {
      id: `msg_u_${Date.now()}`,
      sender: 'user',
      text: message.trim(),
      timestamp: new Date().toISOString()
    };
    history.push(userMsg);

    const replyText = await AIService.chatWithNotes({
      userMessage: message.trim(),
      history,
      allNotes,
      folders,
      lang: lang || 'fr'
    });

    const aiMsg = {
      id: `msg_ai_${Date.now()}`,
      sender: 'ai',
      text: replyText,
      timestamp: new Date().toISOString()
    };
    history.push(aiMsg);

    Storage.saveChatHistory(userId, history);
    res.json({ reply: aiMsg, history });
  } catch (err) {
    console.error('Erreur Chat Cortex IA:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// STATIQUES & SPA FALLBACK
// =============================================================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🧠 NoteVault AI (notes.oussamma.tn) en écoute sur :`);
  console.log(`   - Local  : http://localhost:${PORT}`);
  console.log(`   - Public : ${APP_URL}`);
  console.log(`   - SSO    : ${SSO_BASE_URL} (${SSO_CLIENT_ID})`);
  console.log(`=======================================================`);
});
