// Vídeos do YouTube para o app Kesh Vídeo (central multimídia do carro): em alta, busca, reprodução e download.
// O vídeo passa pelo servidor (as URLs do googlevideo valem só para o IP de quem pediu), em até 720p H.264,
// que a central decodifica pelo hardware. O download vira um MP4 (vídeo + áudio) que o app baixa e guarda.
import { execFile, spawn } from 'child_process';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { auth, signStream, verifyStream } from '../security.js';
import { ah, bad, notFound, str } from '../util.js';
import { YTDLP_JS } from './imports.js';
import { UPLOAD_ROOT } from './media.js';
import { chunkRange, parseRange, sendChunks } from './youtube.js';

export const videoRouter = express.Router();

const API_KEY = process.env.YOUTUBE_API_KEY || '';
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_EXTRA = (process.env.YTDLP_ARGS || '').split(/\s+/).filter(Boolean);
const VIDEO_DIR = path.join(UPLOAD_ROOT, 'videos');
const KEEP_H = Number(process.env.VIDEO_KEEP_H || 48); // MP4 pronto fica no servidor até o app baixar (ou 48 h)
const QUALITIES = [360, 480, 720];
const ytId = (v) => {
  const id = String(v || '');
  if (!/^[\w-]{11}$/.test(id)) throw bad('Vídeo inválido');
  return id;
};
const quality = (v) => (QUALITIES.includes(Number(v)) ? Number(v) : 720);
const decode = (s) => String(s || '').replace(/&(amp|quot|#39|lt|gt);/g, (_m, e) => ({ amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' })[e]);
const isoDuration = (v) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v || '');
  return m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 0;
};

// ---------- Catálogo (YouTube Data API, com cache para poupar a cota) ----------

const cache = new Map(); // chave -> { at, items }
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.items;
  const items = await fn();
  cache.set(key, { at: Date.now(), items });
  while (cache.size > 300) cache.delete(cache.keys().next().value);
  return items;
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
  title: decode(v.snippet?.title),
  channel: decode(v.snippet?.channelTitle),
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

/** yt-dlp em modo lista (sem baixar nada): reserva quando a API não responde ou a cota acabou. */
function ytdlpList(target) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, ['--flat-playlist', '-J', '--no-warnings', ...YTDLP_JS, '--extractor-args', 'youtube:lang=pt', target], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(err);
      try {
        resolve((JSON.parse(out).entries || []).filter((e) => /^[\w-]{11}$/.test(e.id || '')).map((e) => ({
          youtube_id: e.id, title: e.title || '', channel: e.channel || e.uploader || '', duration_ms: Math.round((e.duration || 0) * 1000),
          views: Number(e.view_count || 0), published_at: null, live: e.live_status === 'is_live',
        })));
      } catch (e) { reject(e); }
    });
  });
}

// Categorias da aba "Em alta" (ids de categoria do YouTube no Brasil)
const CATEGORIES = { all: null, musica: '10', jogos: '20', esportes: '17', noticias: '25', entretenimento: '24', humor: '23', ciencia: '28', carros: '2' };

videoRouter.use('/video', auth());

/** Em alta no Brasil, por categoria. */
videoRouter.get('/video/feed', ah(async (req, res) => {
  const cat = Object.hasOwn(CATEGORIES, req.query.cat) ? req.query.cat : 'all';
  const items = await cached(`feed:${cat}`, 30 * 60 * 1000, async () => {
    if (API_KEY) {
      try {
        const j = await api('videos', { part: 'snippet,contentDetails,statistics', chart: 'mostPopular', regionCode: 'BR', hl: 'pt', maxResults: '40', ...(CATEGORIES[cat] ? { videoCategoryId: CATEGORIES[cat] } : {}) });
        return (j.items || []).map(fromVideo);
      } catch (e) { console.error('[video] feed API:', e.message); }
    }
    return ytdlpList(`ytsearch30:${cat === 'all' ? 'em alta brasil' : cat}`);
  });
  res.json({ categories: Object.keys(CATEGORIES), items });
}));

/** Busca de vídeos (100 unidades da cota por busca na API; cache de 6 h). */
videoRouter.get('/video/search', ah(async (req, res) => {
  const text = str(req.query.q, 'Busca', { required: true, max: 120 });
  const items = await cached(`q:${text.toLowerCase()}`, 6 * 3600 * 1000, async () => {
    if (API_KEY) {
      try {
        const j = await api('search', { part: 'id', type: 'video', regionCode: 'BR', relevanceLanguage: 'pt', maxResults: '30', q: text });
        return details((j.items || []).map((i) => i.id?.videoId).filter(Boolean));
      } catch (e) { console.error('[video] search API:', e.message); }
    }
    return ytdlpList(`ytsearch30:${text}`);
  });
  res.json({ items });
}));

/** Vídeos parecidos (o que tocar depois): busca pelo canal e pelo começo do título. */
videoRouter.get('/video/related/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const items = await cached(`rel:${id}`, 6 * 3600 * 1000, async () => {
    const [v] = await details([id]).catch(() => []);
    if (!v) return [];
    const q = `${v.channel} ${v.title.split(/[|([-]/)[0]}`.slice(0, 100);
    const j = await api('search', { part: 'id', type: 'video', regionCode: 'BR', relevanceLanguage: 'pt', maxResults: '20', q });
    return (await details((j.items || []).map((i) => i.id?.videoId).filter((x) => x && x !== id)));
  }).catch(() => []);
  res.json({ items });
}));

// ---------- Reprodução ----------

const direct = new Map(); // `${id}:${q}` -> { until, promise: { video, audio } }

/** URLs do googlevideo pelo yt-dlp: vídeo H.264 até a qualidade pedida + áudio AAC; sem isso, o MP4 360p junto. */
function resolveStreams(id, q, force = false) {
  const key = `${id}:${q}`;
  const hit = direct.get(key);
  if (!force && hit && hit.until > Date.now()) return hit.promise;
  const run = (fmt) => new Promise((resolve, reject) => {
    execFile(YTDLP, ['-f', fmt, '-g', '--no-playlist', '--no-warnings', ...YTDLP_JS, `https://www.youtube.com/watch?v=${id}`], { timeout: 60000 }, (err, out) => {
      const urls = String(out || '').trim().split('\n').filter((l) => l.startsWith('http'));
      if (err || !urls.length) return reject(err || new Error('sem URL'));
      resolve(urls);
    });
  });
  const promise = run(`bv*[height<=${q}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]`)
    .then((u) => (u.length >= 2 ? { video: u[0], audio: u[1] } : { video: u[0], audio: null }))
    .catch(() => run('18').then((u) => ({ video: u[0], audio: null })))
    .catch(() => { throw bad('Não foi possível abrir o vídeo', 'VIDEO_UNAVAILABLE'); });
  const entry = { until: Infinity, promise };
  direct.set(key, entry);
  promise.then((s) => {
    let exp = 0;
    try { exp = Number(new URL(s.video).searchParams.get('expire')) * 1000; } catch { /* sem expire */ }
    entry.until = exp > Date.now() ? exp - 10 * 60 * 1000 : Date.now() + 3600 * 1000;
  }, () => { if (direct.get(key) === entry) direct.delete(key); });
  while (direct.size > 200) direct.delete(direct.keys().next().value);
  return promise;
}

const signed = (kind, id, q, userId, ttlS) => {
  const { exp, sig, u } = signStream(`${kind}:${id}:${q}`, userId, ttlS);
  return `?q=${q}&u=${u}&exp=${exp}&sig=${sig}`;
};

/** Links (assinados, o player não manda o login) do vídeo e do áudio para tocar. */
videoRouter.get('/video/play/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const q = quality(req.query.q);
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
  const q = quality(req.query.q);
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

function nextJob() {
  if (running) return;
  const key = queue.shift();
  if (!key) return;
  const [id, q] = key.split(':');
  const job = jobs.get(key);
  running = true;
  job.status = 'running';
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const tmp = path.join(VIDEO_DIR, `${id}-${q}.part`);
  const p = spawn(YTDLP, [
    '-f', `bv*[height<=${q}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=${q}][ext=mp4]/18`,
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
    } else {
      job.status = 'error';
      job.message = 'Não foi possível baixar o vídeo';
      console.error('[video] download', id, code, err);
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
  const j = jobs.get(key);
  return j ? { status: j.status, progress: j.progress || 0, message: j.message || null } : { status: 'none', progress: 0 };
}

/** Pede o MP4 do vídeo (entra na fila; um por vez). */
videoRouter.post('/video/downloads', ah(async (req, res) => {
  const id = ytId(req.body?.youtube_id);
  const q = quality(req.body?.q);
  const key = `${id}:${q}`;
  const j = jobs.get(key);
  if (!fs.existsSync(fileOf(id, q)) && (!j || j.status === 'error')) {
    jobs.set(key, { status: 'queued', progress: 0 });
    queue.push(key);
    nextJob();
  }
  res.json(jobView(id, q, req.user.id));
}));

videoRouter.get('/video/downloads/:id', ah(async (req, res) => {
  res.json(jobView(ytId(req.params.id), quality(req.query.q), req.user.id));
}));

/** O app já guardou o vídeo: o servidor apaga o MP4. */
videoRouter.delete('/video/downloads/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const q = quality(req.query.q);
  fs.rmSync(fileOf(id, q), { force: true });
  jobs.delete(`${id}:${q}`);
  res.json({ ok: true });
}));

/** Arquivo MP4 pronto (link assinado, com Range: o app pode continuar um download interrompido). */
videoRouter.get('/vfile/:id', ah(async (req, res) => {
  const id = ytId(req.params.id);
  const q = quality(req.query.q);
  if (!verifyStream(`file:${id}:${q}`, req.query)) return res.status(403).json({ error: { code: 'URL_EXPIRED', message: 'Link expirado' } });
  const f = fileOf(id, q);
  if (!fs.existsSync(f)) throw notFound('Vídeo não está mais no servidor');
  res.sendFile(f, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' } });
}));

/** MP4 que o app não buscou sai depois de KEEP_H horas. */
export function startVideoSweeper() {
  const sweep = () => {
    try {
      for (const f of fs.readdirSync(VIDEO_DIR)) {
        const full = path.join(VIDEO_DIR, f);
        if (Date.now() - fs.statSync(full).mtimeMs > KEEP_H * 3600 * 1000) fs.rmSync(full, { force: true });
      }
    } catch { /* pasta ainda não existe */ }
  };
  sweep();
  setInterval(sweep, 3600 * 1000).unref();
}
