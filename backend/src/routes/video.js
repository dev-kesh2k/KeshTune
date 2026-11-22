// Vídeos do YouTube para o app Kesh Vídeo (central multimídia do carro): em alta, busca, reprodução e download.
// O vídeo passa pelo servidor (as URLs do googlevideo valem só para o IP de quem pediu), em até 1080p H.264
// (padrão 720p; a central do carro pede no máximo 720p e decodifica pelo hardware). O download vira um MP4 (vídeo + áudio) que o app baixa e guarda.
import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { q as dbq } from '../db.js';
import { auth, signStream, verifyStream } from '../security.js';
import { ah, bad, notFound, str } from '../util.js';
import { YTDLP_JS } from './imports.js';
import { decodeEntities, interleave, isoDuration } from '../media-links.js';
import { UPLOAD_ROOT } from './media.js';
import { chunkRange, parseRange, readyDelay, sendChunks } from './youtube.js';

export const videoRouter = express.Router();

const API_KEY = process.env.YOUTUBE_API_KEY || '';
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_EXTRA = (process.env.YTDLP_ARGS || '').split(/\s+/).filter(Boolean);
const VIDEO_DIR = path.join(UPLOAD_ROOT, 'videos');
const KEEP_H = Number(process.env.VIDEO_KEEP_H || 48); // MP4 pronto fica no servidor até o app baixar (ou 48 h)
const QUALITIES = [360, 480, 720, 1080];
// Vídeo com várias dublagens: áudio em português quando o YouTube tem; senão o original (o padrão do yt-dlp é o original)
const AUDIO_PT = '(ba[ext=m4a][language^=pt]/ba[ext=m4a])';
// A escolha do áudio vai junto da qualidade numa etiqueta: "720" = português quando houver, "720o" = original
// (o app manda audio=original). Assim os caches, os links assinados e os arquivos de cada escolha ficam separados.
const qtag = (qv, audio) => {
  const raw = String(qv ?? '');
  const q = quality(raw.replace(/o$/, ''));
  return audio === 'original' || raw.endsWith('o') ? `${q}o` : String(q);
};
const qNum = (t) => Number.parseInt(String(t), 10);
const audioSel = (t) => (String(t).endsWith('o') ? 'ba[ext=m4a]' : AUDIO_PT);
export const VIDEO_MAX_HEIGHT = QUALITIES[QUALITIES.length - 1]; // vai no /config: o TubeCraft libera o 1080p por ele
const ytId = (v) => {
  const id = String(v || '');
  if (!/^[\w-]{11}$/.test(id)) throw bad('Vídeo inválido');
  return id;
};
const quality = (v) => (QUALITIES.includes(Number(v)) ? Number(v) : 720);

// ---------- Catálogo (YouTube Data API, com cache para poupar a cota) ----------

// Cache em memória e em arquivo (uploads/videos/cache): as réplicas do servidor dividem o que já foi buscado.
// Buscas iguais ao mesmo tempo esperam a mesma resposta.
const cache = new Map(); // chave -> { at, items }
const inflight = new Map();
const CACHE_DIR = path.join(VIDEO_DIR, 'cache');
const cacheFile = (key) => path.join(CACHE_DIR, `${crypto.createHash('sha256').update(key).digest('hex')}.json`);
async function cached(key, ttlMs, fn, force = false) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.items;
  if (!force) try {
    const f = JSON.parse(fs.readFileSync(cacheFile(key), 'utf8'));
    if (Date.now() - f.at < ttlMs && f.items?.length) { cache.set(key, f); return f.items; }
  } catch { /* sem arquivo */ }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const items = await fn();
    const entry = { at: Date.now(), items };
    cache.set(key, entry);
    while (cache.size > 300) cache.delete(cache.keys().next().value);
    if (items.length) {
      try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cacheFile(key), JSON.stringify(entry)); } catch { /* sem disco */ }
    }
    return items;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

async function api(pathname, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
  for (const [k, v] of Object.entries({ ...params, key: API_KEY })) u.searchParams.set(k, v);
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  return r.json();
}

const fromVideo = (v) => ({
  youtube_id: v.id,
  title: decodeEntities(v.snippet?.title),
  channel: decodeEntities(v.snippet?.channelTitle),
  duration_ms: isoDuration(v.contentDetails?.duration),
  views: Number(v.statistics?.viewCount || 0),
  published_at: v.snippet?.publishedAt || null,
  live: v.snippet?.liveBroadcastContent === 'live',
});

/** Detalhes (duração, visualizações) de até 50 ids por chamada (1 unidade da cota cada). */
async function details(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await api('videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') });
    out.push(...(j.items || []).map(fromVideo));
  }
  const byId = new Map(out.map((v) => [v.youtube_id, v]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Fila com no máximo [n] yt-dlp ao mesmo tempo: cada um abre um Node próprio (runtime de JS). Com 170 MB, vários
 * juntos derrubavam a API; com 2 GB (desde 2026-11-22) cabem alguns em paralelo sem um esperar o outro.
 */
function lane(n = 1) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= n || !waiting.length) return;
    running++;
    const { fn, resolve, reject } = waiting.shift();
    void Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}
// Buscas numa fila e abertura de vídeo noutra (quem aperta tocar não espera o aquecimento das abas)
const oneAtATime = lane(2);
const playLane = lane(3);
const warmLane = lane(2); // pré-carga dos links (próximo vídeo, primeiros da lista)

/** yt-dlp em modo lista (sem baixar nada): reserva quando a API não responde ou a cota acabou. */
function ytdlpList(target) {
  return oneAtATime(() => new Promise((resolve, reject) => {
    execFile(YTDLP, ['--flat-playlist', '-J', '--no-warnings', ...YTDLP_JS, '--extractor-args', 'youtube:lang=pt', target], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(err);
      try {
        resolve((JSON.parse(out).entries || []).filter((e) => /^[\w-]{11}$/.test(e.id || '')).map((e) => ({
          youtube_id: e.id, title: e.title || '', channel: e.channel || e.uploader || '', duration_ms: Math.round((e.duration || 0) * 1000),
          views: Number(e.view_count || 0), published_at: null, live: e.live_status === 'is_live',
        })));
      } catch (e) { reject(e); }
    });
  }));
}

// Abas da tela inicial. Sem chave da API, o "Em alta" do YouTube não existe mais (a página foi tirada em 2025):
// cada aba é uma busca. "Para você" usa os artistas mais ouvidos no KeshTune.
const CATEGORIES = {
  'para-voce': null,
  musica: ['clipe oficial lançamento', 'música nova 2025 clipe'],
  futebol: ['futebol melhores momentos', 'gols da rodada'],
  noticias: ['notícias hoje jornal', 'jornal nacional hoje'],
  humor: ['humor brasileiro vídeo', 'stand up comedy brasil'],
  games: ['gameplay português', 'jogos lançamento gameplay'],
  carros: ['avaliação carro 2025', 'carros review brasil'],
  ciencia: ['curiosidades ciência', 'documentário português'],
};
const LABELS = { 'para-voce': 'Para você', musica: 'Música', futebol: 'Futebol', noticias: 'Notícias', humor: 'Humor', games: 'Games', carros: 'Carros', ciencia: 'Ciência' };

async function topArtists(userId) {
  const r = await dbq(
    `SELECT a.name FROM play_history h JOIN track_artists ta ON ta.track_id = h.track_id JOIN artists a ON a.id = ta.artist_id
      WHERE h.user_id = $1 AND h.played_at > now() - interval '60 days' GROUP BY a.name ORDER BY count(*) DESC LIMIT 5`,
    [userId]
  );
  return r.map((x) => x.name);
}

async function feed(cat, userId, force = false) {
  if (cat === 'para-voce') {
    const artists = await topArtists(userId);
    if (!artists.length) return feed('musica', userId);
    // Cache de 2 h; o aquecimento refaz a cada 50 min por cima (quem abrir nunca espera)
    return cached(`feed:pv:${userId}`, 2 * 3600 * 1000, async () =>
      interleave(await Promise.all(artists.map((a) => searchList(`${a} clipe`, 12, force).catch(() => [])))), force);
  }
  return cached(`feed:${cat}`, 2 * 3600 * 1000, async () =>
    interleave(await Promise.all(CATEGORIES[cat].map((t) => searchList(t, 20).catch(() => [])))));
}

/** Busca pelo yt-dlp (ou pela API, se houver chave), com cache. */
function searchList(text, n, force = false) {
  return cached(`s:${n}:${text.toLowerCase()}`, 6 * 3600 * 1000, async () => {
    if (API_KEY) {
      try {
        const j = await api('search', { part: 'id', type: 'video', regionCode: 'BR', relevanceLanguage: 'pt', maxResults: String(n), q: text });
        return details((j.items || []).map((i) => i.id?.videoId).filter(Boolean));
      } catch (e) { console.error('[video] search API:', e.message); }
    }
    return ytdlpList(`ytsearch${n}:${text}`);
  }, force);
}

videoRouter.use('/video', auth());

/** Abas da tela inicial. */
videoRouter.get('/video/feed', ah(async (req, res) => {
  const cat = Object.hasOwn(CATEGORIES, req.query.cat) ? req.query.cat : 'para-voce';
  res.json({ categories: Object.keys(CATEGORIES).map((id) => ({ id, label: LABELS[id] })), items: await feed(cat, req.user.id) });
}));

/** Aquece as abas fixas (o yt-dlp leva alguns segundos por busca): no boot e a cada 2 h. */
export function startVideoWarmup() {
  // "Para você" dos donos de aparelho fixo (carro) fica sempre pronto: o cache dele vale 1 h e é refeito a cada 50 min
  const run = async () => {
    const owners = await dbq(`SELECT DISTINCT user_id FROM device_keys WHERE revoked_at IS NULL`).catch(() => []);
    for (const o of owners) {
      // Outra réplica já renovou há pouco: não repete
      let fresh = false;
      try { fresh = Date.now() - JSON.parse(fs.readFileSync(cacheFile(`feed:pv:${o.user_id}`), 'utf8')).at < 40 * 60 * 1000; } catch { /* sem arquivo */ }
      const items = fresh ? [] : await feed('para-voce', o.user_id, true).catch(() => []);
      prefetch(items.map((v) => v.youtube_id), 720);
    }
    for (const cat of Object.keys(CATEGORIES)) if (CATEGORIES[cat]) await feed(cat).catch(() => {});
  };
  // Réplicas começam em horários diferentes; quem chegar depois já acha o arquivo pronto
  setTimeout(run, crypto.randomInt(30_000, 90_000)).unref();
  setInterval(run, 50 * 60 * 1000).unref();
}

/** Busca de vídeos. */
videoRouter.get('/video/search', ah(async (req, res) => {
  const text = str(req.query.q, 'Busca', { required: true, max: 120 });
  res.json({ items: await searchList(text, 30) });
}));

/** Para tocar depois: mais vídeos do mesmo canal e do mesmo assunto (o app manda título e canal). */
videoRouter.get('/video/related/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const title = String(req.query.title || '').split(/[|([\-]/)[0].trim().slice(0, 80);
  const channel = String(req.query.channel || '').slice(0, 60);
  const lists = await Promise.all([channel && searchList(channel, 15), title && searchList(title, 15)].filter(Boolean).map((p) => p.catch(() => [])));
  res.json({ items: interleave(lists, 30).filter((v) => v.youtube_id !== id) });
}));

// ---------- Reprodução ----------

const direct = new Map(); // `${id}:${q}` -> { until, promise: { video, audio } }

/** URLs do googlevideo pelo yt-dlp: vídeo H.264 até a qualidade pedida + áudio AAC; sem isso, o MP4 360p junto. */
function resolveStreams(id, q, force = false, laneFn = playLane) {
  const key = `${id}:${q}:pt`;
  const hit = direct.get(key);
  if (!force && hit && hit.until > Date.now()) return hit.promise;
  // Outra réplica já descobriu (arquivo dividido entre elas)
  const shared = path.join(CACHE_DIR, `play-${id}-${q}-pt.json`); // -pt: links antigos (áudio original) não valem mais
  if (!force) {
    try {
      const f = JSON.parse(fs.readFileSync(shared, 'utf8'));
      if (f.until > Date.now()) {
        const e = { until: f.until, promise: Promise.resolve(f.streams) };
        direct.set(key, e);
        return e.promise;
      }
    } catch { /* sem arquivo */ }
  }
  const run = (fmt) => laneFn(() => new Promise((resolve, reject) => {
    // Primeira linha: quando o YouTube libera as URLs (vídeo|áudio|formato único); depois as URLs, uma por linha
    const ready = '%(requested_formats.0.available_at)s|%(requested_formats.1.available_at)s|%(available_at)s';
    execFile(YTDLP, ['-f', fmt, '--print', ready, '--print', 'urls', '--no-playlist', '--no-warnings', ...YTDLP_JS, `https://www.youtube.com/watch?v=${id}`], { timeout: 60000 }, (err, out) => {
      const lines = String(out || '').trim().split('\n');
      const urls = lines.filter((l) => l.startsWith('http'));
      if (err || !urls.length) return reject(err || new Error('sem URL'));
      // Antes da hora que o YouTube marcou o googlevideo responde 403: espera só o necessário (às vezes nada).
      setTimeout(() => resolve(urls), readyDelay(lines[0]));
    });
  }));
  const promise = run(`bv*[height<=${qNum(q)}][vcodec^=avc1][ext=mp4]+${audioSel(q)}`)
    .then((u) => (u.length >= 2 ? { video: u[0], audio: u[1] } : { video: u[0], audio: null }))
    .catch(() => run('18').then((u) => ({ video: u[0], audio: null })))
    .catch(() => { throw bad('Não foi possível abrir o vídeo', 'VIDEO_UNAVAILABLE'); });
  const entry = { until: Infinity, promise };
  direct.set(key, entry);
  promise.then((s) => {
    let exp = 0;
    try { exp = Number(new URL(s.video).searchParams.get('expire')) * 1000; } catch { /* sem expire */ }
    entry.until = exp > Date.now() ? exp - 10 * 60 * 1000 : Date.now() + 3600 * 1000;
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(shared, JSON.stringify({ until: entry.until, streams: s })); } catch { /* sem disco */ }
  }, () => { if (direct.get(key) === entry) direct.delete(key); });
  while (direct.size > 200) direct.delete(direct.keys().next().value);
  return promise;
}

const signed = (kind, id, q, userId, ttlS) => {
  const { exp, sig, u } = signStream(`${kind}:${id}:${q}`, userId, ttlS);
  return `?q=${q}&u=${u}&exp=${exp}&sig=${sig}`;
};

/** Já descobre os links destes vídeos (o yt-dlp leva uns 10 s): o app pede para o próximo da fila. */
function prefetch(ids, q) {
  for (const id of ids.slice(0, 6)) if (/^[\w-]{11}$/.test(id)) resolveStreams(id, q, false, warmLane).catch(() => {});
}
videoRouter.post('/video/prefetch', ah(async (req, res) => {
  prefetch(Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [], qtag(req.body?.q, req.body?.audio));
  res.json({ ok: true });
}));

/** Links (assinados, o player não manda o login) do vídeo e do áudio para tocar. */
videoRouter.get('/video/play/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const q = qtag(req.query.q, req.query.audio);
  const s = await resolveStreams(id, q);
  res.json({
    video: `vproxy/${id}/video${signed('video', id, q, req.user.id, 6 * 3600)}`,
    audio: s.audio ? `vproxy/${id}/audio${signed('audio', id, q, req.user.id, 6 * 3600)}` : null,
  });
}));

/** Repassa o vídeo/áudio do googlevideo em pedaços (como o áudio do KeshTune), respeitando o Range do player. */
videoRouter.get('/vproxy/:id/:kind', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const kind = req.params.kind === 'audio' ? 'audio' : 'video';
  const q = qtag(req.query.q);
  if (!verifyStream(`${kind}:${id}:${q}`, req.query)) return res.status(403).json({ error: { code: 'URL_EXPIRED', message: 'Link expirado' } });
  let closed = false;
  let ac = null;
  res.on('close', () => { closed = true; ac?.abort(); });
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await resolveStreams(id, q, attempt > 0);
    const url = kind === 'audio' ? s.audio : s.video;
    if (!url) throw notFound('Sem áudio separado');
    if (closed) return;
    const asked = parseRange(req.headers.range);
    if (!asked) return res.status(416).end();
    ac = new AbortController();
    const t0 = setTimeout(() => ac.abort(), 15000);
    const up = await fetch(url, { headers: { Range: chunkRange(asked.start, asked.end) }, signal: ac.signal }).catch(() => null);
    clearTimeout(t0);
    if (closed) return;
    if (!up || up.status === 403 || up.status === 410) {
      await up?.body?.cancel().catch(() => {});
      if (attempt === 0) continue;
      throw bad('Não foi possível abrir o vídeo', 'VIDEO_UNAVAILABLE');
    }
    if (up.status === 416) return res.status(416).set('Content-Range', up.headers.get('content-range') || '').end();
    const total = Number(/\/(\d+)$/.exec(up.headers.get('content-range') || '')?.[1]) || 0;
    res.set({ 'Content-Type': kind === 'audio' ? 'audio/mp4' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    if (up.status === 206 && total) {
      const end = Math.min(asked.end ?? total - 1, total - 1);
      if (req.headers.range) res.status(206).set('Content-Range', `bytes ${asked.start}-${end}/${total}`);
      else res.status(200);
      res.set('Content-Length', String(end - asked.start + 1));
      await sendChunks(url, up, asked.start, end, res, () => closed);
      return;
    }
    res.status(up.status);
    const body = Readable.fromWeb(up.body);
    body.on('error', () => res.destroy());
    body.pipe(res);
    return;
  }
}));

// ---------- Download (MP4 pronto no servidor, o app baixa e guarda) ----------

const jobs = new Map(); // `${id}:${q}` -> { status: 'queued'|'running'|'done'|'error', progress, message }
const queue = [];
let running = false;
const fileOf = (id, q) => path.join(VIDEO_DIR, `${id}-${q}.mp4`);
// O servidor roda em várias réplicas: o andamento vai num arquivo ao lado do vídeo para qualquer uma responder
const stateOf = (id, q) => path.join(VIDEO_DIR, `${id}-${q}.json`);
function writeState(id, q, job) {
  try { fs.writeFileSync(stateOf(id, q), JSON.stringify({ status: job.status, progress: job.progress || 0, message: job.message || null, at: Date.now() })); } catch { /* sem disco */ }
}
function readState(id, q) {
  try {
    const st = JSON.parse(fs.readFileSync(stateOf(id, q), 'utf8'));
    // Réplica que caiu no meio: estado parado há mais de 10 min vira erro (o app pede de novo)
    if ((st.status === 'running' || st.status === 'queued') && Date.now() - st.at > 10 * 60 * 1000) return { ...st, status: 'error', message: 'Download interrompido' };
    return st;
  } catch { return null; }
}

function nextJob() {
  if (running) return;
  const key = queue.shift();
  if (!key) return;
  const [id, q] = key.split(':');
  const job = jobs.get(key);
  running = true;
  job.status = 'running';
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  writeState(id, q, job);
  let lastWrite = 0;
  const tmp = path.join(VIDEO_DIR, `${id}-${q}.part`);
  const p = spawn(YTDLP, [
    '-f', `bv*[height<=${qNum(q)}][vcodec^=avc1][ext=mp4]+${audioSel(q)}/b[height<=${qNum(q)}][ext=mp4]/18`,
    '--merge-output-format', 'mp4', '--no-playlist', '--no-part', '--newline', '--no-warnings', '-o', `${tmp}.%(ext)s`,
    ...YTDLP_JS, ...YTDLP_EXTRA, `https://www.youtube.com/watch?v=${id}`,
  ]);
  // Vídeo e áudio baixam um depois do outro: o vídeo conta 0–90% e o áudio o resto
  let part = 0;
  p.stdout.on('data', (d) => {
    for (const line of String(d).split('\n')) {
      if (/\[download\] Destination:/.test(line)) part++;
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) job.progress = Math.min(99, Math.round(part <= 1 ? Number(m[1]) * 0.9 : 90 + Number(m[1]) * 0.1));
      if (m && Date.now() - lastWrite > 1500) { lastWrite = Date.now(); writeState(id, q, job); }
    }
  });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
  const timer = setTimeout(() => p.kill('SIGKILL'), 30 * 60 * 1000);
  p.on('close', (code) => {
    clearTimeout(timer);
    const out = `${tmp}.mp4`;
    if (code === 0 && fs.existsSync(out)) {
      fs.renameSync(out, fileOf(id, q));
      job.status = 'done';
      job.progress = 100;
      fs.rmSync(stateOf(id, q), { force: true });
    } else {
      job.status = 'error';
      job.message = 'Não foi possível baixar o vídeo';
      console.error('[video] download', id, code, err);
      writeState(id, q, job);
      for (const f of fs.readdirSync(VIDEO_DIR)) if (f.startsWith(`${id}-${q}.part`)) fs.rmSync(path.join(VIDEO_DIR, f), { force: true });
    }
    running = false;
    nextJob();
  });
}

function jobView(id, q, userId) {
  const key = `${id}:${q}`;
  const f = fileOf(id, q);
  if (fs.existsSync(f)) {
    return { status: 'done', progress: 100, size: fs.statSync(f).size, file: `vfile/${id}${signed('file', id, q, userId, 6 * 3600)}` };
  }
  const j = jobs.get(key) || readState(id, q);
  return j ? { status: j.status, progress: j.progress || 0, message: j.message || null } : { status: 'none', progress: 0 };
}

/** Pede o MP4 do vídeo (entra na fila; um por vez). */
videoRouter.post('/video/downloads', ah(async (req, res) => {
  const id = ytId(req.body?.youtube_id);
  const q = qtag(req.body?.q, req.body?.audio);
  const key = `${id}:${q}`;
  const j = jobs.get(key) || readState(id, q);
  if (!fs.existsSync(fileOf(id, q)) && (!j || j.status === 'error')) {
    const job = { status: 'queued', progress: 0 };
    jobs.set(key, job);
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    writeState(id, q, job);
    queue.push(key);
    nextJob();
  }
  res.json(jobView(id, q, req.user.id));
}));

videoRouter.get('/video/downloads/:id', ah(async (req, res) => {
  res.json(jobView(ytId(req.params.id), qtag(req.query.q, req.query.audio), req.user.id));
}));

/** O app já guardou o vídeo: o servidor apaga o MP4. */
videoRouter.delete('/video/downloads/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const q = qtag(req.query.q, req.query.audio);
  fs.rmSync(fileOf(id, q), { force: true });
  fs.rmSync(stateOf(id, q), { force: true });
  jobs.delete(`${id}:${q}`);
  res.json({ ok: true });
}));

/** Arquivo MP4 pronto (link assinado, com Range: o app pode continuar um download interrompido). */
videoRouter.get('/vfile/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const q = qtag(req.query.q);
  if (!verifyStream(`file:${id}:${q}`, req.query)) return res.status(403).json({ error: { code: 'URL_EXPIRED', message: 'Link expirado' } });
  const f = fileOf(id, q);
  if (!fs.existsSync(f)) throw notFound('Vídeo não está mais no servidor');
  res.sendFile(f, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' } });
}));

/** MP4 que o app não buscou sai depois de KEEP_H horas. */
export function startVideoSweeper() {
  const sweepDir = (dir, maxAgeMs) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const f of names) {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && Date.now() - st.mtimeMs > maxAgeMs) fs.rmSync(full, { force: true });
      } catch { /* sumiu no meio */ }
    }
  };
  const sweep = () => {
    sweepDir(VIDEO_DIR, KEEP_H * 3600 * 1000);
    sweepDir(CACHE_DIR, 24 * 3600 * 1000);
  };
  sweep();
  setInterval(sweep, 3600 * 1000).unref();
}
