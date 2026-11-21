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
  // Confere ida e volta: o Date aceita 2026-02-31 (vira 3 de março) e isso não pode passar
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw bad(`${name} inválida`);
  return v;
}
/** E-mail no formato nome@dominio.tld: um "@", sem espaços, e um ponto no domínio com 2+ caracteres depois. */
export function isEmail(v) {
  if (typeof v !== 'string' || v.length > 254 || /\s/.test(v)) return false;
  const at = v.indexOf('@');
  if (at < 1 || v.indexOf('@', at + 1) >= 0) return false;
  const domain = v.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot > 0 && domain.length - dot - 1 >= 2;
}

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
    // Cabeçalhos padrão (draft IETF RateLimit): o app pode saber quanto falta antes de levar 429
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - h.n)));
    res.set('RateLimit-Reset', String(Math.ceil((h.reset - now) / 1000)));
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
  // Planilha salva pelo Excel ("CSV UTF-8") começa com BOM e o 1º cabeçalho viraria "\uFEFFtitulo"
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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

// ---------------- Texto sem expressão regular com retrocesso ----------------
// Funções simples que fazem o mesmo que as regex antigas (o SonarQube aponta risco de lentidão nelas).

const SPACE_RE = /\s/;
const LINE_END_RE = /[\n\r\u2028\u2029]/;
/** Mesmo conjunto de espaços do `\s` das regex. */
export const isSpace = (c) => c !== undefined && SPACE_RE.test(c);
const isLineEnd = (c) => c !== undefined && LINE_END_RE.test(c);

// Comparação sem diferenciar maiúsculas igual à flag `i` das regex (sem `u`): um caractere fora do ASCII
// nunca vira um do ASCII (ex.: o "K" do Kelvin não é "k").
function foldChar(c) {
  const u = c.toUpperCase();
  if (u.length !== 1) return c;
  if (c.charCodeAt(0) >= 128 && u.charCodeAt(0) < 128) return c;
  return u;
}
/** `s` tem `word` na posição `at` (sem diferenciar maiúsculas). */
export function hasWordAt(s, word, at) {
  if (at < 0 || at + word.length > s.length) return false;
  for (let i = 0; i < word.length; i++) if (foldChar(s[at + i]) !== foldChar(word[i])) return false;
  return true;
}
/** `s` termina em `word` (sem diferenciar maiúsculas). */
export const endsWithWord = (s, word) => hasWordAt(s, word, s.length - word.length);

/** Início da sequência de espaços que termina em `end` (sem passar de `min`). */
export function spaceRunStart(s, end, min = 0) {
  let i = end;
  while (i > min && isSpace(s[i - 1])) i--;
  return i;
}
/** Fim da sequência de espaços que começa em `start`. */
export function spaceRunEnd(s, start) {
  let i = start;
  while (i < s.length && isSpace(s[i])) i++;
  return i;
}
/** Tira do fim todas as repetições do caractere `ch` (ex.: barras ou "=" finais). */
export function trimEndChar(s, ch) {
  let i = s.length;
  while (i > 0 && s[i - 1] === ch) i--;
  return s.slice(0, i);
}

/** Tira " - Topic" do fim do nome de um canal do YouTube (canais automáticos de artista). */
export function stripTopicSuffix(s) {
  if (!endsWithWord(s, 'Topic')) return s;
  const dash = spaceRunStart(s, s.length - 5);
  if (dash === 0 || s[dash - 1] !== '-') return s;
  return s.slice(0, spaceRunStart(s, dash - 1));
}

/** Tira "VEVO", "Oficial", "Official" ou "TV" do fim do nome de um canal (com os espaços antes). */
export function stripChannelSuffix(s) {
  const word = ['VEVO', 'Oficial', 'Official', 'TV'].find((w) => endsWithWord(s, w));
  return word ? s.slice(0, spaceRunStart(s, s.length - word.length)) : s;
}

/** Nome do canal sem " - Topic" e sem "VEVO"/"Oficial"/"Official"/"TV" no fim. */
export const cleanChannelName = (s) => stripChannelSuffix(stripTopicSuffix(s));

/** Divide o texto em cada linha (os mesmos separadores de linha das regex). */
export function splitLines(s) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (isLineEnd(s[i])) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

const TAG_WORDS = ['official', 'oficial', 'clipe', 'video', 'vídeo', 'audio', 'áudio', 'lyric', 'letra', 'visualizer', 'hd', '4k', 'mv'];
const isAsciiWord = (c) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_');
const isClose = (c) => c === ')' || c === ']';
const DASHES = '-–—';

/**
 * Tira etiquetas como "(Official Video)", "[Áudio]", "(Lyrics)", "[4K]" do título (e os espaços antes):
 * parêntese ou colchete que começa com uma dessas palavras inteiras, até o primeiro ")" ou "]".
 */
export function stripTitleTags(s) {
  let out = '';
  let from = 0;
  let j = 0;
  while (j < s.length) {
    const open = j;
    j++;
    if (s[open] !== '(' && s[open] !== '[') continue;
    // "lyric" cobre "lyrics": o "s" não é parêntese, então o fechamento é o mesmo
    const ok = TAG_WORDS.some((w) => hasWordAt(s, w, open + 1)
      && (!isAsciiWord(s[open + 1 + w.length]) || (w === 'lyric' && (s[open + 6] === 's' || s[open + 6] === 'S') && !isAsciiWord(s[open + 7]))));
    if (!ok) continue;
    let close = open + 1;
    while (close < s.length && !isClose(s[close])) close++;
    if (close >= s.length) continue;
    out += s.slice(from, spaceRunStart(s, open, from));
    from = close + 1;
    j = from;
  }
  return out + s.slice(from);
}

/** Tira " - Official", " – Oficial Vídeo", " - Official Audio"... do fim do título. */
export function stripOfficialSuffix(s) {
  let k = spaceRunStart(s, s.length);
  const media = ['video', 'vídeo', 'audio', 'áudio', 'clipe'].find((w) => endsWithWord(s.slice(0, k), w));
  if (media) {
    const before = k - media.length;
    if (!isSpace(s[before - 1])) return s;
    k = spaceRunStart(s, before);
  }
  const word = ['official', 'oficial'].find((w) => endsWithWord(s.slice(0, k), w));
  if (!word) return s;
  const dash = spaceRunStart(s, k - word.length) - 1;
  if (dash < 0 || !DASHES.includes(s[dash]) || !isSpace(s[dash - 1])) return s;
  return s.slice(0, spaceRunStart(s, dash));
}

/** Divide em cada " | " (barra com espaço dos dois lados; os espaços em volta somem). */
export function splitPipes(s) {
  const out = [];
  let from = 0;
  let j = 0;
  while (j < s.length) {
    const bar = j;
    j++;
    if (s[bar] !== '|' || bar === from || !isSpace(s[bar - 1]) || !isSpace(s[bar + 1])) continue;
    out.push(s.slice(from, spaceRunStart(s, bar, from)));
    from = spaceRunEnd(s, bar + 1);
    j = from;
  }
  out.push(s.slice(from));
  return out;
}

/**
 * "Artista - Música" -> [texto, "Artista", "Música"] no primeiro traço (-, – ou —) com espaço dos dois lados;
 * nenhuma das partes pode ter quebra de linha. null se não houver.
 */
export function splitDashTitle(t) {
  for (let i = 1; i < t.length; i++) {
    if (isLineEnd(t[i - 1])) return null;
    if (!isSpace(t[i])) continue;
    const k = spaceRunEnd(t, i);
    if (k >= t.length || !DASHES.includes(t[k])) continue;
    const e = spaceRunEnd(t, k + 1);
    if (e === k + 1) continue;
    let r = e;
    if (e === t.length) {
      // Sem nada depois dos espaços: o último espaço vira a segunda parte (como a regex fazia)
      if (e - 1 < k + 2 || isLineEnd(t[e - 1])) continue;
      r = e - 1;
    } else if (splitLines(t.slice(e)).length > 1) continue;
    return [t, t.slice(0, i), t.slice(r)];
  }
  return null;
}
