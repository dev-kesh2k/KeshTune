import { execFile } from 'child_process';
import express from 'express';
import { Readable } from 'stream';
import { one, q, tx } from '../db.js';
import { adminOnly, audit, auth, verifyStream } from '../security.js';
import { getSettings } from '../seed.js';
import { ah, bad, forbidden, int, notFound, str, uuidList, uuidParam } from '../util.js';
import { hydrateTracks } from '../views.js';
import { createTrack, findOrCreateArtist } from './admin.js';
import { saveImage } from './media.js';
import { detect, enqueueJob, YTDLP_JS } from './imports.js';
import { addToMyMusic, createPlaylistWithTracks } from './playlists.js';

// Busca no YouTube para qualquer usuário: pela YouTube Data API quando há YOUTUBE_API_KEY (cota de ~100 buscas/dia
// no plano gratuito) e pelo yt-dlp quando não há chave ou a cota acabou. Tocar ou adicionar um resultado cadastra a
// faixa no catálogo (source 'youtube'); "Baixar" pede ao servidor o áudio pelo yt-dlp e a faixa vira arquivo próprio.
const API_KEY = process.env.YOUTUBE_API_KEY || '';
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const CACHE_MS = 6 * 3600 * 1000;
const cache = new Map(); // busca normalizada -> { at, items }
const known = new Map(); // youtube_id -> metadados vistos na busca (para cadastrar sem nova consulta)
const inflight = new Map(); // busca normalizada -> promise (a mesma busca repetida espera a primeira, sem rodar outra)

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const decode = (s) => String(s || '').replace(/&(amp|quot|#39|lt|gt);/g, (_m, e) => ({ amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' })[e]);
const isoDuration = (v) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v || '');
  return m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 0;
};

async function searchApi(text, n = 12) {
  const found = [];
  let pageToken = '';
  while (found.length < n) {
    const s = new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({ part: 'snippet', type: 'video', videoEmbeddable: 'true', videoCategoryId: '10', regionCode: 'BR', maxResults: String(Math.min(50, n - found.length)), q: text, key: API_KEY, ...(pageToken ? { pageToken } : {}) })
      .forEach(([k, v]) => s.searchParams.set(k, v));
    const r = await fetch(s, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`YouTube API ${r.status}`);
    const j = await r.json();
    found.push(...(j.items || []));
    pageToken = j.nextPageToken;
    if (!pageToken || !j.items?.length) break;
  }
  const ids = found.map((i) => i.id?.videoId).filter(Boolean);
  const durations = {};
  for (let i = 0; i < ids.length; i += 50) {
    const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.slice(i, i + 50).join(',')}&key=${API_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (v.ok) for (const x of (await v.json()).items || []) durations[x.id] = isoDuration(x.contentDetails?.duration);
  }
  return found.filter((i) => i.id?.videoId).map((i) => ({
    youtube_id: i.id.videoId, title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle), duration_ms: durations[i.id.videoId] || 0,
  }));
}

/** Roda o yt-dlp em modo lista (--flat-playlist, sem baixar nada) e devolve o JSON. */
function ytdlpJson(target, extra = []) {
  return new Promise((resolve, reject) => {
    // lang=pt: sem isso o YouTube devolve títulos traduzidos automaticamente (ex.: para inglês)
    execFile(YTDLP, ['--flat-playlist', '-J', '--no-warnings', ...YTDLP_JS, '--extractor-args', 'youtube:lang=pt', ...extra, target], { timeout: 120000, maxBuffer: 50 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

const videoEntries = (entries) => (entries || [])
  .filter((e) => /^[\w-]{11}$/.test(e.id || '') && !/^\[(private|deleted|privado|exclu)/i.test(e.title || ''))
  .map((e) => ({ youtube_id: e.id, title: e.title || '', channel: e.channel || e.uploader || '', duration_ms: Math.round((e.duration || 0) * 1000) }));

async function searchYtdlp(text, n = 12) {
  return videoEntries((await ytdlpJson(`ytsearch${n}:${text}`)).entries);
}

async function searchYoutube(text) {
  text = text.trim();
  const key = text.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let items = null;
    if (API_KEY) {
      try { items = await searchApi(text); } catch (e) { console.error('[youtube] API:', e.message); }
    }
    if (!items) {
      if (!(await detect('youtube')).available) throw bad('Busca no YouTube indisponível (sem YOUTUBE_API_KEY e sem yt-dlp no servidor)', 'YOUTUBE_UNAVAILABLE');
      try { items = await searchYtdlp(text); } catch (e) { console.error('[youtube] yt-dlp:', e.message); throw bad('Não foi possível buscar no YouTube agora'); }
    }
    for (const i of items) known.set(i.youtube_id, i);
    while (known.size > 5000) known.delete(known.keys().next().value);
    cache.set(key, { at: Date.now(), items });
    while (cache.size > 300) cache.delete(cache.keys().next().value);
    return items;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/** Muitos resultados de uma vez (carga de gêneros): yt-dlp primeiro para não gastar a cota da API. */
async function searchMany(text, n) {
  if ((await detect('youtube')).available) {
    try { return await searchYtdlp(text, n); } catch (e) { console.error('[youtube] yt-dlp:', e.message); }
  }
  if (API_KEY) return searchApi(text, n);
  throw bad('Busca no YouTube indisponível (sem yt-dlp e sem YOUTUBE_API_KEY)', 'YOUTUBE_UNAVAILABLE');
}

async function apiGet(path, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...params, key: API_KEY }).forEach(([k, v]) => v && u.searchParams.set(k, v));
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  return r.json();
}

/** Playlists do YouTube para a busca (yt-dlp primeiro para não gastar a cota da API). */
async function searchPlaylists(text) {
  const key = `pl:${text.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  let items = null;
  if ((await detect('youtube')).available) {
    try {
      const j = await ytdlpJson(`https://www.youtube.com/results?search_query=${encodeURIComponent(text)}&sp=EgIQAw%253D%253D`, ['--playlist-end', '12']);
      items = (j.entries || []).filter((e) => /^(PL|OL|RD)[\w-]{8,}$/.test(e.id || '')).map((e) => ({
        playlist_id: e.id, title: e.title || '', channel: e.channel || e.uploader || '', thumbnail_url: (e.thumbnails || []).slice(-1)[0]?.url || null,
      }));
    } catch (e) { console.error('[youtube] playlists yt-dlp:', e.message); }
  }
  if (!items && API_KEY) {
    const j = await apiGet('search', { part: 'snippet', type: 'playlist', maxResults: '12', regionCode: 'BR', q: text });
    items = (j.items || []).map((i) => ({
      playlist_id: i.id.playlistId, title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle), thumbnail_url: i.snippet.thumbnails?.high?.url || null,
    }));
  }
  if (!items) throw bad('Busca de playlists no YouTube indisponível agora', 'YOUTUBE_UNAVAILABLE');
  for (const i of items) if (i.thumbnail_url && !/^https:\/\/i\.ytimg\.com\//.test(i.thumbnail_url)) i.thumbnail_url = null;
  cache.set(key, { at: Date.now(), items });
  return items;
}

/** Título e vídeos de uma playlist do YouTube (até 500). */
async function readPlaylist(listId) {
  if ((await detect('youtube')).available) {
    try {
      const j = await ytdlpJson(`https://www.youtube.com/playlist?list=${listId}`, ['--playlist-end', '500']);
      return { title: j.title || 'Playlist do YouTube', channel: j.channel || j.uploader || '', videos: videoEntries(j.entries) };
    } catch (e) { console.error('[youtube] playlist yt-dlp:', e.message); }
  }
  if (!API_KEY) throw bad('Não foi possível ler a playlist do YouTube agora', 'YOUTUBE_UNAVAILABLE');
  const info = (await apiGet('playlists', { part: 'snippet', id: listId })).items?.[0];
  if (!info) throw notFound('Playlist não encontrada ou privada');
  const videos = [];
  let pageToken = '';
  do {
    const j = await apiGet('playlistItems', { part: 'snippet', playlistId: listId, maxResults: '50', pageToken });
    for (const i of j.items || []) {
      const vid = i.snippet?.resourceId?.videoId;
      if (vid) videos.push({ youtube_id: vid, title: decode(i.snippet.title), channel: decode(i.snippet.videoOwnerChannelTitle || ''), duration_ms: 0 });
    }
    pageToken = j.nextPageToken;
  } while (pageToken && videos.length < 500);
  return { title: decode(info.snippet.title), channel: decode(info.snippet.channelTitle), videos: videos.filter((v) => !/^(private|deleted) video$/i.test(v.title)) };
}

// Coletâneas, mixes e vídeos longos não são "uma música"
const NOT_A_SONG = /\b(mix|mixes|playlist|hora|horas|hour|hours|compila[cç][aã]o|compilation|[áa]lbum completo|full album|mais tocadas|as melhores|top \d+|sele[cç][aã]o|medley|ao vivo completo|dvd completo|show completo)\b/i;

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * "Artista - Música (Official Video) | Ao Vivo #DVD" -> { artist, title }. Sem traço, o artista é o canal;
 * se a segunda parte é o canal ("Música - Artista"), inverte.
 */
function splitTitle(raw, channel) {
  let t = raw
    .replace(/#\S+/g, '')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/\s*[([](?:official|oficial|clipe|v[ií]deo|audio|áudio|lyrics?|letra|visualizer|hd|4k|mv)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+[-–—]\s*(?:official|oficial)(?:\s+(?:video|v[ií]deo|audio|áudio|clipe))?\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
  const pipe = t.split(/\s+\|\s+/);
  t = pipe.find((p) => /\s[-–—]\s/.test(p)) || pipe[0] || raw; // "| Ao Vivo Em Goiânia", "| Nome do DVD"...
  const ch = String(channel || '').replace(/\s*-\s*Topic$/i, '').replace(/\s*(?:VEVO|Oficial|Official|TV)$/i, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (!m) return { artist: ch || 'YouTube', title: t || raw };
  const [a, b] = [m[1].trim(), m[2].trim()];
  if (ch && norm(b).startsWith(norm(ch)) && !norm(a).startsWith(norm(ch))) return { artist: b, title: a };
  return { artist: a, title: b };
}

// ---------------- Fotos de artistas ----------------
// Artistas cadastrados a partir de vídeos não têm foto: usa o avatar do canal do YouTube com o mesmo nome.
const channelName = (s) => norm(String(s || '').replace(/\s*-\s*Topic$/i, '').replace(/\s*(?:VEVO|Oficial|Official|TV)$/i, '')).replace(/ /g, '');

async function findArtistImage(name) {
  const j = await ytdlpJson(`https://www.youtube.com/results?search_query=${encodeURIComponent(name)}&sp=EgIQAg%253D%253D`, ['--playlist-end', '5']);
  const want = channelName(name);
  const ch = (j.entries || []).find((e) => want && channelName(e.channel || e.title) === want);
  let url = (ch?.thumbnails || []).slice(-1)[0]?.url;
  if (!url) return null;
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https:\/\/yt3\.(ggpht|googleusercontent)\.com\//.test(url)) return null;
  const r = await fetch(url.replace(/=s\d+-/, '=s400-'), { signal: AbortSignal.timeout(10000) });
  if (!r.ok || Number(r.headers.get('content-length') || 0) > 3 * 1024 * 1024) return null;
  return await saveImage(Buffer.from(await r.arrayBuffer()));
}

let imagesBusy = false;
/** Busca fotos dos artistas sem imagem, dos mais tocados para os menos (3 por vez). Devolve quantas achou. */
export async function fillArtistImages() {
  if (imagesBusy || !(await detect('youtube')).available) return 0;
  imagesBusy = true;
  let found = 0;
  try {
    for (;;) {
      const batch = await q(
        `SELECT a.id, a.name FROM artists a
          WHERE a.image_url IS NULL AND (a.image_checked_at IS NULL OR a.image_checked_at < now() - interval '30 days')
          ORDER BY (SELECT COALESCE(sum(t.popularity), 0) FROM track_artists ta JOIN tracks t ON t.id = ta.track_id WHERE ta.artist_id = a.id) DESC, a.created_at
          LIMIT 30`
      );
      if (!batch.length) break;
      for (let i = 0; i < batch.length; i += 3) {
        await Promise.all(batch.slice(i, i + 3).map(async (a) => {
          let img = null;
          try { img = await findArtistImage(a.name); } catch (e) { console.error('[artist-image]', a.name, e.message); }
          await q(`UPDATE artists SET image_checked_at = now(), image_url = COALESCE(image_url, $2) WHERE id = $1`, [a.id, img]);
          if (img) found++;
        }));
      }
    }
  } finally {
    imagesBusy = false;
  }
  return found;
}

export function startArtistImageWorker() {
  setInterval(() => fillArtistImages().catch((e) => console.error('[artist-image]', e.message)), 10 * 60 * 1000).unref();
  setTimeout(() => fillArtistImages().catch((e) => console.error('[artist-image]', e.message)), 30000).unref();
  // Parada dos artistas em alta já pronta antes do primeiro Início (a busca roda em segundo plano)
  setTimeout(() => trendingArtistsBR(null).catch(() => {}), 5000).unref();
}

async function catalogMatches(ids) {
  if (!ids.length) return new Map();
  const rows = await q(
    `SELECT DISTINCT ON (youtube_id) youtube_id, id, source FROM tracks
      WHERE youtube_id = ANY($1) AND status = 'active' ORDER BY youtube_id, (source = 'file') DESC, created_at`,
    [ids]
  );
  return new Map(rows.map((r) => [r.youtube_id, r]));
}

async function youtubeOn() {
  if (!(await getSettings()).youtube_enabled) throw forbidden('Faixas do YouTube estão desativadas pelo administrador', 'YOUTUBE_DISABLED');
}

export const youtubeRouter = express.Router();

// ----- Áudio direto do YouTube (app nativo) -----
// O app não toca o player incorporado: o servidor descobre a URL do áudio com o yt-dlp e repassa os bytes (com Range,
// para avançar). Toca em poucos segundos, sem esperar a gravação do áudio como arquivo próprio (no formato original),
// que segue na fila para as próximas vezes.
// A URL do googlevideo vale só para o IP que a pediu, por isso o servidor repassa em vez de entregar a URL ao app.
const direct = new Map(); // youtube_id -> { until, promise: { url, mime } }
const DIRECT_MS = 2 * 3600 * 1000; // validade quando a URL não diz quando vence

/**
 * URL do áudio pelo yt-dlp (alguns segundos), guardada até perto de vencer: a própria URL traz o "expire".
 * O acerto de cache volta com cached: true (a URL pode ter sido recusada depois; quem chama pode pedir outra com force).
 */
function directAudio(vid, force = false) {
  const hit = direct.get(vid);
  if (!force && hit && hit.until > Date.now()) return hit.until === Infinity ? hit.promise : hit.promise.then((a) => ({ ...a, cached: true }));
  const promise = new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-warnings', '--print', 'ext', '--print', 'url', ...YTDLP_JS, `https://www.youtube.com/watch?v=${vid}`],
      { timeout: 60000, windowsHide: true },
      (err, stdout) => {
        const [ext, url] = String(stdout || '').trim().split('\n');
        if (err || !url?.startsWith('http')) return reject(bad('Não foi possível abrir o áudio do YouTube', 'YT_STREAM_FAILED'));
        resolve({ url, mime: ext === 'webm' ? 'audio/webm' : 'audio/mp4' });
      }
    );
  });
  const entry = { until: Infinity, promise }; // pendente: quem chegar espera a mesma consulta
  direct.set(vid, entry);
  promise.then((a) => {
    let exp = 0;
    try { exp = Number(new URL(a.url).searchParams.get('expire')) * 1000; } catch { /* sem expire legível */ }
    entry.until = exp > Date.now() ? exp - 10 * 60 * 1000 : Date.now() + DIRECT_MS;
  }, () => { if (direct.get(vid) === entry) direct.delete(vid); });
  while (direct.size > 500) direct.delete(direct.keys().next().value);
  return promise;
}

/** Já descobre a URL do áudio antes de o app pedir o stream (o yt-dlp leva alguns segundos). */
export function warmYoutube(vid) {
  if (vid) directAudio(vid).catch(() => {});
}

/** Grava o áudio como arquivo próprio sem pressa (pista normal), se ainda não houver gravação pedida para a faixa. */
async function queueConversion(t, userId) {
  const pending = await one(`SELECT 1 FROM import_jobs WHERE track_id = $1 AND status IN ('queued','running')`, [t.id]);
  if (!pending) await enqueueJob({ kind: 'youtube', url: `https://www.youtube.com/watch?v=${t.youtube_id}`, trackId: t.id, userId });
}

/** URL assinada (como /stream/:id), porque o player do app não manda o cabeçalho de login. Vem de POST /playback/session. */
youtubeRouter.get('/youtube/stream/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  if (!verifyStream(id, req.query)) return res.status(403).json({ error: { code: 'URL_EXPIRED', message: 'Link de reprodução expirado' } });
  const t = await one(
    `SELECT t.id, t.youtube_id, t.source FROM tracks t JOIN users u ON u.id = $2 AND u.status = 'active' AND u.deleted_at IS NULL
      WHERE t.id = $1 AND t.status = 'active'`,
    [id, req.query.u]
  );
  if (!t?.youtube_id) throw notFound('Faixa não encontrada', 'TRACK_NOT_FOUND');
  // Só no começo da música (o player faz vários pedidos com Range ao avançar)
  const fromStart = !req.headers.range || /^bytes=0-/.test(req.headers.range);
  if (t.source === 'youtube' && fromStart) queueConversion(t, req.query.u).catch(() => {});
  // Upstream ligado à conexão do app: se o player desistir (pulou de faixa), para de baixar do googlevideo.
  // Um AbortController por tentativa (o da anterior pode ter sido abortado pelo prazo)
  let closed = false;
  let ac = null;
  res.on('close', () => {
    closed = true;
    ac?.abort();
  });
  let fresh = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await directAudio(t.youtube_id, fresh);
    if (closed) return;
    ac = new AbortController();
    // Só a espera pelos cabeçalhos tem limite (internet instável); o corpo segue enquanto o player ler
    const t0 = setTimeout(() => ac.abort('timeout'), 10000);
    const up = await fetch(a.url, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: ac.signal }).catch(() => null);
    clearTimeout(t0);
    if (closed) return;
    // Falha de rede ou demora até o googlevideo (passageiras): tenta mais uma vez com a mesma URL, que não foi recusada
    if (!up) {
      if (attempt === 0) continue;
      if (ac.signal.reason === 'timeout') {
        if (!res.headersSent) res.status(502).json({ error: { code: 'YT_STREAM_FAILED', message: 'O YouTube demorou para responder' } });
        return;
      }
      throw bad('Não foi possível abrir o áudio do YouTube', 'YT_STREAM_FAILED');
    }
    // URL vencida ou recusada: se veio do cache, pede outra ao yt-dlp uma vez
    if (up.status === 403 || up.status === 410) {
      await up.body?.cancel().catch(() => {});
      if (attempt === 0 && a.cached) {
        fresh = true;
        continue;
      }
      throw bad('Não foi possível abrir o áudio do YouTube', 'YT_STREAM_FAILED');
    }
    if (up.status === 416) {
      res.status(416).set('Content-Range', up.headers.get('content-range') || '').end();
      return;
    }
    if (!up.ok) throw bad('Não foi possível abrir o áudio do YouTube', 'YT_STREAM_FAILED');
    res.status(up.status).set({ 'Content-Type': a.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    for (const h of ['content-length', 'content-range']) {
      const v = up.headers.get(h);
      if (v) res.set(h, v);
    }
    const body = Readable.fromWeb(up.body);
    body.on('error', () => res.destroy());
    body.pipe(res);
    return;
  }
}));

youtubeRouter.use('/youtube', auth());

youtubeRouter.get('/youtube/search', ah(async (req, res) => {
  await youtubeOn();
  const text = str(req.query.q, 'Busca', { required: true, max: 200 });
  const items = await searchYoutube(text);
  const inCatalog = await catalogMatches(items.map((i) => i.youtube_id));
  res.json({
    items: items.map((i) => ({
      ...i, thumbnail_url: thumb(i.youtube_id), track_id: inCatalog.get(i.youtube_id)?.id || null, saved: inCatalog.get(i.youtube_id)?.source === 'file',
    })),
  });
}));

/** Cadastra (ou acha) a faixa do vídeo no catálogo e devolve a faixa pronta para tocar. */
youtubeRouter.post('/youtube/tracks', ah(async (req, res) => {
  await youtubeOn();
  const vid = String(req.body?.youtube_id || '');
  if (!/^[\w-]{11}$/.test(vid)) throw bad('Vídeo inválido');
  let id = (await catalogMatches([vid])).get(vid)?.id;
  if (!id) {
    let meta = known.get(vid);
    if (!meta) {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      const d = r?.ok ? await r.json() : null;
      if (!d) throw bad('Vídeo não encontrado ou não permite incorporação');
      meta = { title: d.title, channel: d.author_name, duration_ms: 0 };
    }
    const { artist, title } = splitTitle(meta.title, meta.channel);
    ({ id } = await createTrack({
      source: 'youtube', youtube_id: vid, title: title.slice(0, 200), artists: [artist.slice(0, 200)], cover_url: thumb(vid), duration_ms: meta.duration_ms || 0,
    }, req.user.id));
    await audit(req, 'track.youtube_add', 'track', id, { youtube_id: vid, title });
  }
  // Tocar costuma vir logo em seguida: já descobre a URL do áudio (faixa que já é arquivo não precisa). Só para o
  // app nativo (warm=1), que toca pelo stream; o site toca pelo player incorporado e não precisa do yt-dlp
  const [track] = await hydrateTracks([id], req.user);
  if (track?.source !== 'file' && req.query.warm === '1') warmYoutube(vid);
  res.status(201).json(track);
}));

/** Admin: começa agora a busca de fotos dos artistas sem imagem (roda em segundo plano). */
youtubeRouter.post('/admin/artists/fetch-images', auth(), adminOnly, ah(async (_req, res) => {
  const { n } = await one(`SELECT count(*)::int AS n FROM artists WHERE image_url IS NULL`);
  fillArtistImages().catch((e) => console.error('[artist-image]', e.message));
  res.status(202).json({ pending: n, running: imagesBusy });
}));

youtubeRouter.get('/youtube/playlists', ah(async (req, res) => {
  await youtubeOn();
  const text = str(req.query.q, 'Busca', { required: true, max: 200 });
  res.json({ items: await searchPlaylists(text) });
}));

/** Importa uma playlist do YouTube como playlist privada do usuário (as faixas tocam online). */
youtubeRouter.post('/youtube/playlists/import', ah(async (req, res) => {
  await youtubeOn();
  const listId = String(req.body?.playlist_id || '');
  if (!/^[\w-]{10,64}$/.test(listId)) throw bad('Playlist inválida');
  const pl = await readPlaylist(listId);
  if (!pl.videos.length) throw bad('A playlist está vazia ou é privada');
  const ids = (await ensureTracks(pl.videos, req.user.id)).map((r) => r.id).filter(Boolean);
  const id = await createPlaylistWithTracks(req.user, {
    name: pl.title.slice(0, 100), description: `Importada do YouTube${pl.channel ? ` (${pl.channel})` : ''}`.slice(0, 300),
  }, ids);
  await audit(req, 'playlist.youtube_import', 'playlist', id, { youtube_playlist: listId, tracks: ids.length });
  res.status(201).json({ id, tracks: ids.length });
}));

/**
 * Garante as faixas dos vídeos no catálogo (source 'youtube'), na ordem recebida. Vídeos já cadastrados são
 * reaproveitados (e ganham o gênero, se houver). Devolve [{ id, created }] (id null se não deu para cadastrar).
 */
async function ensureTracks(videos, userId, genreId = null, { convert = true } = {}) {
  for (const v of videos) known.set(v.youtube_id, v);
  const existing = await catalogMatches(videos.map((v) => v.youtube_id));
  const out = [];
  let newArtists = false;
  for (const v of videos) {
    const ex = existing.get(v.youtube_id);
    if (ex) {
      if (genreId) await q(`INSERT INTO track_genres (track_id, genre_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ex.id, genreId]);
      out.push({ id: ex.id, created: false });
      continue;
    }
    const { artist, title } = splitTitle(v.title, v.channel);
    try {
      const t = await createTrack({
        source: 'youtube', youtube_id: v.youtube_id, title: title.slice(0, 200), artists: [artist.slice(0, 200)], cover_url: thumb(v.youtube_id),
        duration_ms: v.duration_ms || 0, genre_ids: genreId ? [genreId] : [],
      }, userId);
      existing.set(v.youtube_id, { id: t.id, source: 'youtube' }); // vídeo repetido na mesma lista
      // converte para arquivo próprio em segundo plano (listas grandes, como o top do artista, só quando alguém tocar)
      if (convert) enqueueJob({ kind: 'youtube', url: `https://www.youtube.com/watch?v=${v.youtube_id}`, trackId: t.id, userId }).catch(() => {});
      out.push({ id: t.id, created: true });
      newArtists = true;
    } catch (e) {
      console.error('[youtube] cadastro', v.youtube_id, e.message);
      out.push({ id: null, created: false });
    }
  }
  if (newArtists) setTimeout(() => fillArtistImages().catch(() => {}), 1000);
  return out;
}

// ---------------- Artistas em alta no Brasil e top 50 de cada artista ----------------

// Parada pública da Apple Music (as 50 mais tocadas no Brasil hoje); não precisa de chave nem gasta cota do YouTube
const CHART_URL = 'https://rss.marketingtools.apple.com/api/v2/br/music/most-played/50/songs.json';
const CHART_RETRY = 30 * 60 * 1000; // parada fora do ar: nova tentativa só depois disso
let chart = { at: 0, ids: [] };
let chartBusy = null;
let chartFailAt = 0;

/**
 * Nome do artista principal de cada música da parada. Duplas vêm como "Zé Neto & Cristiano" e participações como
 * "Hugo & Guilherme & Zé Vaqueiro": fica o nome mais curto que também aparece sozinho na parada.
 */
function chartArtists(results) {
  const first = (s) => String(s || '').split(/,\s*/)[0].trim();
  const alone = new Set(results.map((r) => first(r.artistName)).filter(Boolean));
  const score = new Map();
  for (const [i, r] of results.entries()) {
    const name = first(r.artistName);
    if (!name) continue;
    const credit = [...alone].filter((s) => name === s || name.startsWith(`${s} & `)).sort((a, b) => a.length - b.length)[0] || name;
    score.set(credit, (score.get(credit) || 0) + (results.length - i));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/**
 * Top 10 artistas em alta no Brasil, como artistas do catálogo (cadastra os que faltam). Atualiza a cada 6 h.
 * Não espera a parada: devolve na hora a última lista ([] na primeira vez) e atualiza em segundo plano.
 */
export async function trendingArtistsBR(userId) {
  const fresh = chart.ids.length && Date.now() - chart.at < 6 * 3600 * 1000;
  if (!fresh && !chartBusy && Date.now() - chartFailAt > CHART_RETRY) {
    chartBusy = (async () => {
      const r = await fetch(CHART_URL, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`parada ${r.status}`);
      const names = chartArtists((await r.json()).feed?.results || []).slice(0, 10);
      if (!names.length) throw new Error('parada vazia');
      const ids = [];
      for (const n of names) ids.push(await findOrCreateArtist({ q, one }, n.slice(0, 200)));
      chart = { at: Date.now(), ids };
      setTimeout(() => fillArtistImages().catch(() => {}), 1000);
      // Deixa o top 50 desses artistas pronto antes de alguém abrir (um por vez)
      (async () => {
        for (const id of ids) {
          const a = await one(`SELECT id, name, top_fetched_at FROM artists WHERE id = $1`, [id]);
          if (a && topStale(a)) await artistTop(a, userId).catch((e) => console.error('[artist-top]', a.name, e.message));
        }
      })().catch((e) => console.error('[artist-top]', e.message));
    })().catch((e) => {
      chartFailAt = Date.now();
      console.error('[home] artistas em alta:', e.message);
    }).finally(() => { chartBusy = null; });
  }
  return chart.ids;
}

export const topStale = (a) => !a.top_fetched_at || Date.now() - new Date(a.top_fetched_at).getTime() > 7 * 86400000;

/** Vídeos do YouTube mais vistos de uma busca (ordenados por visualizações). */
async function mostViewed(text, n) {
  if ((await detect('youtube')).available) {
    try {
      // sp=CAMSAhAB: ordenar por visualizações, só vídeos
      const j = await ytdlpJson(`https://www.youtube.com/results?search_query=${encodeURIComponent(text)}&sp=CAMSAhAB`, ['--playlist-end', String(n)]);
      return videoEntries(j.entries);
    } catch (e) { console.error('[youtube] mais vistos:', e.message); }
  }
  return searchMany(text, n);
}

const topBusy = new Map(); // artist id -> promise

/** Busca as 50 músicas mais vistas do artista no YouTube e guarda em artist_top_tracks (tocam pelo YouTube). */
export function artistTop(artist, userId) {
  if (topBusy.has(artist.id)) return topBusy.get(artist.id);
  const p = (async () => {
    if (!(await getSettings()).youtube_enabled) return;
    const want = norm(artist.name);
    const seen = new Set();
    const songs = (await mostViewed(`${artist.name} música`, 120)).filter((v) => {
      if (seen.has(v.youtube_id) || NOT_A_SONG.test(v.title)) return false;
      seen.add(v.youtube_id);
      if (v.duration_ms && (v.duration_ms < 90000 || v.duration_ms > 600000)) return false;
      // Só vídeos do próprio artista (no título ou no canal)
      return !!want && norm(`${v.title} ${v.channel}`).includes(want);
    }).slice(0, 50);
    const ids = [...new Set((await ensureTracks(songs, userId, null, { convert: false })).map((r) => r.id).filter(Boolean))];
    await tx(async (db) => {
      await db.q(`DELETE FROM artist_top_tracks WHERE artist_id = $1`, [artist.id]);
      for (const [rank, trackId] of ids.entries()) {
        await db.q(`INSERT INTO artist_top_tracks (artist_id, rank, track_id) VALUES ($1,$2,$3)`, [artist.id, rank, trackId]);
      }
      await db.q(`UPDATE artists SET top_fetched_at = now() WHERE id = $1`, [artist.id]);
    });
  })().catch(async (e) => {
    // Falhou na primeira vez (yt-dlp fora, rede): tenta de novo em 30 min, em vez de a cada abertura do artista
    await q(
      `UPDATE artists SET top_fetched_at = now() - interval '7 days' + interval '30 minutes' WHERE id = $1 AND top_fetched_at IS NULL`,
      [artist.id]
    ).catch(() => {});
    throw e;
  }).finally(() => topBusy.delete(artist.id));
  topBusy.set(artist.id, p);
  return p;
}

/**
 * Admin: preenche o gênero com as músicas em alta no YouTube (tocam online pelo player oficial; nada é baixado).
 * Vídeos já no catálogo só ganham o gênero; os novos entram com popularidade inicial pela posição no ranking.
 */
youtubeRouter.post('/admin/genres/:id/trending', auth(), adminOnly, ah(async (req, res) => {
  await youtubeOn();
  const id = int(req.params.id, 'id', { min: 1, required: true });
  const limit = int(req.body?.limit, 'Quantidade', { min: 1, max: 200 }) || 100;
  const g = await one(`SELECT id, name, kind FROM genres WHERE id = $1`, [id]);
  if (!g) throw notFound('Gênero não encontrado');
  const query = g.kind === 'mood' ? `músicas para ${g.name.toLowerCase()} ${new Date().getFullYear()}` : `${g.name} músicas em alta ${new Date().getFullYear()}`;
  const found = await searchMany(query, Math.round(limit * 1.6));
  const seen = new Set();
  const songs = found.filter((i) => {
    if (seen.has(i.youtube_id) || NOT_A_SONG.test(i.title)) return false;
    seen.add(i.youtube_id);
    return !i.duration_ms || (i.duration_ms >= 90000 && i.duration_ms <= 600000);
  }).slice(0, limit);
  const done = await ensureTracks(songs, req.user.id, id);
  for (const [rank, r] of done.entries()) {
    if (r.created) await q(`UPDATE tracks SET popularity = GREATEST(popularity, $2) WHERE id = $1`, [r.id, limit - rank]);
  }
  const added = done.filter((r) => r.created).length;
  const linked = done.filter((r) => r.id && !r.created).length;
  await audit(req, 'admin.genre_trending', 'genre', id, { name: g.name, added, linked });
  res.json({ genre: g.name, added, linked, total: added + linked });
}));

/**
 * Pede ao servidor o áudio de várias faixas do YouTube (yt-dlp, uma por vez na fila); cada uma vira 'file' ao terminar.
 * As faixas já entram em "Minhas músicas". Faixas que já são arquivo voltam como 'done'.
 */
youtubeRouter.post('/youtube/downloads', ah(async (req, res) => {
  const ids = uuidList(req.body?.track_ids, 'track_ids', 500);
  const urgent = !!req.body?.urgent && ids.length <= 5; // ouvinte esperando a faixa tocar
  const tracks = new Map((await q(`SELECT id, source, youtube_id, status FROM tracks WHERE id = ANY($1::uuid[])`, [ids])).map((t) => [t.id, t]));
  const pending = new Map((await q(
    `SELECT DISTINCT ON (track_id) track_id, id, status FROM import_jobs
      WHERE track_id = ANY($1::uuid[]) AND status IN ('queued','running') ORDER BY track_id, created_at`,
    [ids]
  )).map((j) => [j.track_id, j]));
  let tool = null;
  const items = [];
  for (const id of [...new Set(ids)]) {
    const t = tracks.get(id);
    if (!t || t.status !== 'active') { items.push({ track_id: id, status: 'failed', job_id: null, error: 'Faixa não encontrada' }); continue; }
    if (t.source === 'file') { items.push({ track_id: id, status: 'done', job_id: null }); continue; }
    const p = pending.get(id);
    if (p) {
      if (urgent && p.status === 'queued') await q(`UPDATE import_jobs SET created_at = now() - interval '100 years' WHERE id = $1 AND status = 'queued'`, [p.id]);
      items.push({ track_id: id, status: p.status, job_id: p.id });
      continue;
    }
    tool ??= await detect('youtube');
    if (!tool.available) throw bad('O yt-dlp não está instalado no servidor', 'YTDLP_UNAVAILABLE');
    const jobId = await enqueueJob({ kind: 'youtube', url: `https://www.youtube.com/watch?v=${t.youtube_id}`, trackId: id, userId: req.user.id, urgent });
    items.push({ track_id: id, status: 'queued', job_id: jobId });
  }
  await addToMyMusic(req.user, items.filter((i) => i.status !== 'failed').map((i) => i.track_id)).catch((e) => console.error('[my_music]', e.message));
  res.status(202).json({ items });
}));

/** Situação de vários downloads (?ids=job1,job2); os concluídos já trazem a faixa atualizada. */
youtubeRouter.get('/youtube/jobs', ah(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200).map((x) => uuidParam(x, 'ids'));
  if (!ids.length) return res.json({ items: [] });
  const rows = await q(`SELECT id, status, error, track_id FROM import_jobs WHERE id = ANY($1::uuid[]) AND kind = 'youtube'`, [ids]);
  const done = new Map((await hydrateTracks(rows.filter((r) => r.status === 'done').map((r) => r.track_id), req.user)).map((t) => [t.id, t]));
  res.json({ items: rows.map((r) => ({ ...r, track: done.get(r.track_id) || null })) });
}));
