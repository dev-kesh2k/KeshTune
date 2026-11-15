import crypto from 'crypto';

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (message, code = 'INVALID_INPUT') => new HttpError(400, code, message);
export const notFound = (message = 'Não encontrado', code = 'NOT_FOUND') => new HttpError(404, code, message);
export const forbidden = (message = 'Sem permissão', code = 'FORBIDDEN') => new HttpError(403, code, message);

/** UUID v7 (ordenável por data), seção 7 da especificação. */
export function uuidv7() {
  const b = crypto.randomBytes(16);
  const ts = BigInt(Date.now());
  b[0] = Number((ts >> 40n) & 0xffn);
  b[1] = Number((ts >> 32n) & 0xffn);
  b[2] = Number((ts >> 24n) & 0xffn);
  b[3] = Number((ts >> 16n) & 0xffn);
  b[4] = Number((ts >> 8n) & 0xffn);
  b[5] = Number(ts & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export function uuidParam(v, name = 'id') {
  if (!isUuid(v)) throw bad(`${name} inválido`);
  return v.toLowerCase();
}
export function uuidList(v, name = 'ids', max = 100) {
  if (!Array.isArray(v) || v.length === 0) throw bad(`${name}: informe ao menos um item`);
  if (v.length > max) throw bad(`${name}: no máximo ${max} itens por chamada`);
  return v.map((x) => uuidParam(x, name));
}

export function str(v, name, { min = 0, max = 200, required = false, trim = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} é obrigatório`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${name} inválido`);
  let s = String(v);
  if (trim) s = s.trim();
  if (required && !s) throw bad(`${name} é obrigatório`);
  if (s.length < min) throw bad(`${name} deve ter ao menos ${min} caracteres`);
  if (s.length > max) throw bad(`${name} deve ter no máximo ${max} caracteres`);
  return s || null;
}
export function int(v, name, { min = -2147483648, max = 2147483647, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} é obrigatório`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} inválido`);
  return n;
}
export function oneOf(v, name, list, def) {
  if (v === undefined || v === null || v === '') return def;
  if (!list.includes(v)) throw bad(`${name} inválido`);
  return v;
}
export function dateStr(v, name) {
  if (!v) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} inválida`);
  return v;
}
export const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;

export const token = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Limite de taxa em memória por chave (por réplica). */
export function rateLimiter({ windowMs, max, key, code = 'RATE_LIMITED', message = 'Muitas requisições, tente em instantes' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    if (!k) return next();
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(k, h);
    }
    h.n += 1;
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return next(new HttpError(429, code, message));
    }
    next();
  };
}

export function csvEscape(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Injeção de fórmula: no Excel/Sheets, célula que começa com = + - @ vira fórmula. Prefixa com apóstrofo.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parser CSV simples (aspas, vírgula ou ponto e vírgula). */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
