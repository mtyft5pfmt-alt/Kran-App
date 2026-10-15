'use strict';
// Kran-Wartung Server: liefert die App aus und gleicht Daten zwischen Geräten ab.
// Keine externen Abhängigkeiten – benötigt Node.js 22.13 oder neuer (node:sqlite).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..');
const MAX_BODY = 50 * 1024 * 1024;
const STORES = new Set(['cranes', 'entries']);
const STATIC_FILES = new Set(['index.html', 'manifest.json', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png' };

/* ---------- Datenbank ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'kran-wartung.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, created INTEGER);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created INTEGER, last_seen INTEGER);
  CREATE TABLE IF NOT EXISTS records (
    store TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, updated INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, data TEXT, by_user TEXT, PRIMARY KEY (store, id));
  CREATE INDEX IF NOT EXISTS records_rev ON records(rev);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

const q = {
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  listUsers: db.prepare('SELECT id, name, admin, created FROM users ORDER BY name'),
  addUser: db.prepare('INSERT INTO users (name, pw, admin, created) VALUES (?, ?, ?, ?)'),
  delUser: db.prepare('DELETE FROM users WHERE id = ?'),
  setPw: db.prepare('UPDATE users SET pw = ? WHERE id = ?'),
  countAdmins: db.prepare('SELECT COUNT(*) AS n FROM users WHERE admin = 1'),
  addSession: db.prepare('INSERT INTO sessions (token, user_id, created, last_seen) VALUES (?, ?, ?, ?)'),
  session: db.prepare('SELECT s.token, u.id, u.name, u.admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?'),
  getRev: db.prepare("SELECT value FROM meta WHERE key = 'rev'"),
  setRev: db.prepare("INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
  getRec: db.prepare('SELECT updated FROM records WHERE store = ? AND id = ?'),
  upsertRec: db.prepare(`INSERT INTO records (store, id, rev, updated, deleted, data, by_user) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, id) DO UPDATE SET rev = excluded.rev, updated = excluded.updated,
    deleted = excluded.deleted, data = excluded.data, by_user = excluded.by_user`),
  since: db.prepare('SELECT store, id, updated, deleted, data FROM records WHERE rev > ? ORDER BY rev'),
};
const currentRev = () => Number(q.getRev.get()?.value || 0);

/* ---------- Passwörter ---------- */
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

if (q.countUsers.get().n === 0) {
  const name = process.env.ADMIN_USER || 'admin', pw = process.env.ADMIN_PASSWORD;
  if (pw) {
    q.addUser.run(name, hashPw(pw), 1, Date.now());
    console.log(`Admin-Benutzer „${name}“ angelegt.`);
  } else {
    console.warn('Noch keine Benutzer vorhanden. ADMIN_PASSWORD setzen und Container neu starten.');
  }
}

/* ---------- HTTP-Helfer ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Daten zu groß')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}
function auth(req) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  const s = m && q.session.get(m[1]);
  if (!s) throw new HttpError(401, 'Nicht angemeldet');
  q.touchSession.run(Date.now(), s.token);
  return s;
}
const requireAdmin = u => { if (!u.admin) throw new HttpError(403, 'Nur für Admins'); };
const validName = n => typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 40;
const validPw = p => typeof p === 'string' && p.length >= 6 && p.length <= 200;

// Hinter Cloudflare Tunnel / Reverse Proxy kommen alle Anfragen vom Proxy – echte IP aus dem Header lesen
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
function clientIp(req) {
  if (TRUST_PROXY) {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
}

// Schutz gegen Passwort-Raten: nach 5 Fehlversuchen 1 Minute Sperre pro IP
const failures = new Map();
function checkRate(ip) {
  const f = failures.get(ip);
  if (f && f.count >= 5 && Date.now() < f.until) throw new HttpError(429, 'Zu viele Versuche – bitte 1 Minute warten');
}
function fail(ip) {
  const f = failures.get(ip) || { count: 0 };
  f.count = Date.now() < (f.until || 0) ? f.count + 1 : 1;
  f.until = Date.now() + 60000;
  failures.set(ip, f);
}

/* ---------- API ---------- */
async function api(req, res, route) {
  const method = req.method;
  if (route === 'health' && method === 'GET') return send(res, 200, { app: 'kran-wartung', version: 1 });

  if (route === 'login' && method === 'POST') {
    const ip = clientIp(req);
    checkRate(ip);
    const { name, password } = await readJson(req);
    const u = typeof name === 'string' && q.userByName.get(name.trim());
    if (!u || typeof password !== 'string' || !checkPw(password, u.pw)) {
      fail(ip);
      throw new HttpError(401, 'Benutzername oder Passwort falsch');
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    q.addSession.run(token, u.id, Date.now(), Date.now());
    return send(res, 200, { token, user: { id: u.id, name: u.name, admin: !!u.admin } });
  }

  const me = auth(req);
  if (route === 'me' && method === 'GET') return send(res, 200, { id: me.id, name: me.name, admin: !!me.admin });
  if (route === 'logout' && method === 'POST') { q.delSession.run(me.token); return send(res, 200, { ok: true }); }

  if (route === 'password' && method === 'POST') {
    const { old, password } = await readJson(req);
    const u = q.userById.get(me.id);
    if (typeof old !== 'string' || !checkPw(old, u.pw)) throw new HttpError(400, 'Altes Passwort falsch');
    if (!validPw(password)) throw new HttpError(400, 'Neues Passwort: mindestens 6 Zeichen');
    q.setPw.run(hashPw(password), me.id);
    q.delUserSessions.run(me.id, me.token);
    return send(res, 200, { ok: true });
  }

  if (route === 'sync' && method === 'POST') {
    const { since = 0, changes = [] } = await readJson(req);
    if (!Array.isArray(changes)) throw new HttpError(400, 'changes fehlt');
    db.exec('BEGIN IMMEDIATE');
    try {
      let rev = currentRev();
      for (const c of changes) {
        if (!c || !STORES.has(c.store) || typeof c.id !== 'string' || !c.id || c.id.length > 100) continue;
        const updated = Number(c.updated) || 0;
        const cur = q.getRec.get(c.store, c.id);
        if (cur && cur.updated > updated) continue; // neuere Version liegt schon vor
        const data = c.deleted ? null : JSON.stringify({ ...(c.data || {}), id: c.id, updated });
        q.upsertRec.run(c.store, c.id, ++rev, updated, c.deleted ? 1 : 0, data, me.name);
      }
      q.setRev.run(String(rev));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const rows = q.since.all(Number(since) || 0);
    return send(res, 200, {
      rev: currentRev(),
      changes: rows.map(r => ({ store: r.store, id: r.id, updated: r.updated, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null })),
    });
  }

  if (route === 'users' && method === 'GET') { requireAdmin(me); return send(res, 200, q.listUsers.all().map(u => ({ ...u, admin: !!u.admin }))); }
  if (route === 'users' && method === 'POST') {
    requireAdmin(me);
    const { name, password, admin } = await readJson(req);
    if (!validName(name)) throw new HttpError(400, 'Name: 2–40 Zeichen');
    if (!validPw(password)) throw new HttpError(400, 'Passwort: mindestens 6 Zeichen');
    if (q.userByName.get(name.trim())) throw new HttpError(409, 'Benutzer existiert bereits');
    q.addUser.run(name.trim(), hashPw(password), admin ? 1 : 0, Date.now());
    return send(res, 200, { ok: true });
  }
  let m;
  if ((m = /^users\/(\d+)$/.exec(route)) && method === 'DELETE') {
    requireAdmin(me);
    const id = Number(m[1]);
    if (id === me.id) throw new HttpError(400, 'Du kannst dich nicht selbst löschen');
    q.delUser.run(id);
    return send(res, 200, { ok: true });
  }
  if ((m = /^users\/(\d+)\/password$/.exec(route)) && method === 'POST') {
    requireAdmin(me);
    const { password } = await readJson(req);
    if (!validPw(password)) throw new HttpError(400, 'Passwort: mindestens 6 Zeichen');
    if (!q.userById.get(Number(m[1]))) throw new HttpError(404, 'Benutzer nicht gefunden');
    q.setPw.run(hashPw(password), Number(m[1]));
    q.delUserSessions.run(Number(m[1]), me.token);
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, 'Unbekannte Anfrage');
}

/* ---------- Statische Dateien ---------- */
function serveStatic(res, rel) {
  if (rel === '') rel = 'index.html';
  if (!STATIC_FILES.has(rel)) rel = 'index.html';
  fs.readFile(path.join(PUBLIC_DIR, rel), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    const cache = rel.startsWith('icons/') ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  try {
    if (p.startsWith('api/')) return await api(req, res, p.slice(4).replace(/\/+$/, ''));
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Nicht erlaubt');
    serveStatic(res, p);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Serverfehler' });
  }
});
server.listen(PORT, () => console.log(`Kran-Wartung läuft auf Port ${PORT} (Daten: ${DATA_DIR})`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
