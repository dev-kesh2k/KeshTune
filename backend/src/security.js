import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { one, q } from './db.js';
import { HttpError, sha256, token, trimEndChar } from './util.js';

const SECRET = process.env.JWT_SECRET || '';
if (SECRET.length < 32) {
  console.error('JWT_SECRET ausente ou curto (mínimo 32 caracteres)');
  process.exit(1);
}
const subKey = (label) => crypto.createHmac('sha256', SECRET).update(label).digest();
const WRAP_KEY = subKey('offline-key-wrap');
const STREAM_KEY = subKey('stream-url');
const TOTP_KEY = subKey('totp-secret');

export const ACCESS_TTL_S = 60 * 60; // 1 h
export const REFRESH_TTL_MS = 60 * 24 * 3600 * 1000; // 60 dias

// ---------- Senhas (scrypt, embutido no Node) ----------
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 32, SCRYPT, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}
export function verifyPassword(pw, stored) {
  return new Promise((resolve) => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, N, r, p, salt, hash] = parts;
    const expected = Buffer.from(hash, 'base64');
    crypto.scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(key, expected));
    });
  });
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha deve ter ao menos 8 caracteres';
  if (pw.length > 128) return 'Senha longa demais';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'A senha deve ter letras e números';
  return null;
}
export function tempPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(10)) s += a[b % a.length];
  return `${s}#${crypto.randomInt(10, 99)}`;
}

// ---------- Tokens ----------
export function accessToken(user, sessionId) {
  return jwt.sign({ sub: user.id, sid: sessionId, role: user.role }, SECRET, { expiresIn: ACCESS_TTL_S });
}

export async function createSession(user, req) {
  const id = crypto.randomUUID();
  const refresh = `${id}.${token(32)}`;
  await q(
    `INSERT INTO sessions (id, user_id, refresh_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, user.id, sha256(refresh), String(req.get('user-agent') || '').slice(0, 300), req.ip, new Date(Date.now() + REFRESH_TTL_MS)]
  );
  return { access_token: accessToken(user, id), refresh_token: refresh, expires_in: ACCESS_TTL_S };
}

/** Token de renovação rotativo: cada uso gera um novo; reuso de token antigo revoga a sessão. */
export async function rotateSession(refresh, req) {
  const [sid] = String(refresh || '').split('.');
  const s = await one(`SELECT s.*, u.role, u.status, u.deleted_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id::text = $1`, [sid]);
  if (!s || s.revoked_at || s.expires_at < new Date()) throw new HttpError(401, 'SESSION_EXPIRED', 'Sessão expirada, entre novamente');
  if (s.refresh_hash !== sha256(refresh)) {
    await q(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [s.id]);
    throw new HttpError(401, 'SESSION_EXPIRED', 'Sessão expirada, entre novamente');
  }
  if (s.status !== 'active' || s.deleted_at) throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Conta bloqueada ou excluída');
  const next = `${s.id}.${token(32)}`;
  await q(`UPDATE sessions SET refresh_hash = $2, last_seen_at = now(), ip = $3, expires_at = $4 WHERE id = $1`, [
    s.id, sha256(next), req.ip, new Date(Date.now() + REFRESH_TTL_MS),
  ]);
  return { access_token: accessToken({ id: s.user_id, role: s.role }, s.id), refresh_token: next, expires_in: ACCESS_TTL_S };
}

const userCache = new Map(); // id → { user, at }
export function forgetUser(id) {
  for (const k of userCache.keys()) if (k.startsWith(`${id}:`)) userCache.delete(k);
}

async function loadAuth(req) {
  const h = req.get('authorization') || '';
  const raw = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!raw) return null;
  let payload;
  try {
    payload = jwt.verify(raw, SECRET);
  } catch {
    throw new HttpError(401, 'TOKEN_EXPIRED', 'Sessão expirada');
  }
  const cached = userCache.get(`${payload.sub}:${payload.sid}`);
  if (cached && Date.now() - cached.at < 15000) return cached.user;
  const u = await one(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.must_change_password, u.deleted_at, u.explicit_allowed, u.personalization,
            s.revoked_at
       FROM users u JOIN sessions s ON s.id = $2 AND s.user_id = u.id WHERE u.id = $1`,
    [payload.sub, payload.sid]
  );
  if (!u || u.revoked_at) throw new HttpError(401, 'SESSION_EXPIRED', 'Sessão encerrada');
  if (u.deleted_at || u.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Conta bloqueada ou excluída');
  const user = { ...u, session_id: payload.sid };
  userCache.set(`${payload.sub}:${payload.sid}`, { user, at: Date.now() });
  return user;
}

/** Exige login; com troca de senha pendente só libera as rotas de conta. */
export function auth({ allowPendingPassword = false } = {}) {
  return async (req, _res, next) => {
    try {
      const user = await loadAuth(req);
      if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Faça login');
      if (user.must_change_password && !allowPendingPassword) {
        throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Troque a senha para continuar');
      }
      req.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function optionalAuth() {
  return async (req, _res, next) => {
    try {
      const u = await loadAuth(req).catch(() => null);
      if (u && !u.must_change_password) req.user = u;
    } catch { /* anônimo */ }
    next();
  };
}
export function adminOnly(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'FORBIDDEN', 'Acesso restrito ao administrador'));
  next();
}

export async function audit(req, action, targetType, targetId, details) {
  await q(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`, [
    req.user?.id || null, action, targetType || null, targetId ? String(targetId) : null, details ? JSON.stringify(details) : null, req.ip,
  ]).catch((e) => console.error('[audit]', e.message));
}

// ---------- URLs assinadas de áudio ----------
export function signStream(trackId, userId, ttlS = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const sig = crypto.createHmac('sha256', STREAM_KEY).update(`${trackId}.${userId}.${exp}`).digest('base64url');
  return { exp, sig, u: userId };
}
export function verifyStream(trackId, { u, exp, sig }) {
  if (!u || !exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = crypto.createHmac('sha256', STREAM_KEY).update(`${trackId}.${u}.${exp}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Chaves de conteúdo offline ----------
function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString('base64');
}
function open(key, sealed) {
  const buf = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
}
export const wrapKey = (raw) => seal(WRAP_KEY, raw);
export const unwrapKey = (wrapped) => open(WRAP_KEY, wrapped);
export const sealTotp = (secret) => seal(TOTP_KEY, Buffer.from(secret));
export const openTotp = (sealed) => open(TOTP_KEY, sealed).toString();

/** Cifra o arquivo para o aparelho: IV(12) + AES-256-GCM(dados) + tag(16) — formato do WebCrypto. */
export function encryptForDevice(rawKey, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', rawKey, iv);
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()]);
}

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Segredo novo com 160 bits (32 caracteres base32, como recomenda a RFC 4226). */
export function newTotpSecret() {
  let out = '';
  for (const b of crypto.randomBytes(32)) out += B32[b % 32];
  return out;
}
function b32decode(s) {
  let bits = '';
  for (const c of trimEndChar(s, '=').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function hotp(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}
export function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = b32decode(secret);
  const step = Math.floor(Date.now() / 30000);
  for (const d of [-1, 0, 1]) if (hotp(key, step + d) === c) return true;
  return false;
}
