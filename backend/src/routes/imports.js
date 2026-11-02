import { execFile, spawn } from 'child_process';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { one, q } from '../db.js';
import { adminOnly, audit, auth } from '../security.js';
import { ah, bad, HttpError, notFound, sha256, uuidParam, uuidv7 } from '../util.js';
import { createTrack, MIME_EXT, probeAudio } from './admin.js';
import { AUDIO_DIR, TMP_DIR } from './media.js';

// Importação pelo spotDL (https://github.com/spotDL/spotify-downloader): o admin cola um link do Spotify,
// o spotDL baixa os MP3 já com tags (capa, ISRC, álbum, letra) e cada arquivo entra no catálogo como faixa 'file'.
// A mesma fila baixa o áudio de faixas do YouTube com o yt-dlp (instalado junto com o spotDL): a faixa
// passa de 'youtube' para 'file' sem trocar de id, então curtidas e playlists continuam valendo.
// Requer Python 3.11+, `pip install spotdl` e ffmpeg no servidor. SPOTDL_ARGS / YTDLP_ARGS repassam opções extras
// (ex.: "--client-id X --client-secret Y --ffmpeg /usr/bin/ffmpeg" / "--ffmpeg-location /usr/bin/ffmpeg").
const splitArgs = (v) => String(v || '').split(/\s+/).filter(Boolean);
// O YouTube exige um runtime de JavaScript para liberar vários vídeos ("This video is not available");
// o yt-dlp usa o próprio Node que roda este backend.
export const YTDLP_JS = ['--js-runtimes', `node:${process.execPath}`];
const TOOLS = {
  spotify: { bin: process.env.SPOTDL_BIN || 'spotdl', extra: ['--yt-dlp-args', '--js-runtimes node', ...splitArgs(process.env.SPOTDL_ARGS)], name: 'spotDL' },
  youtube: { bin: process.env.YTDLP_BIN || 'yt-dlp', extra: [...YTDLP_JS, ...splitArgs(process.env.YTDLP_ARGS)], name: 'yt-dlp' },
};
const JOB_TIMEOUT_MS = (Number(process.env.SPOTDL_TIMEOUT_MIN) || 180) * 60 * 1000;
const AUDIO_EXT = /\.(mp3|m4a|opus|ogg|flac|wav)$/i;
const LOG_MAX = 20000;

const detected = {};
/** Verifica se a ferramenta (spotify = spotDL, youtube = yt-dlp) está instalada; resultado guardado por 5 min. */
export function detect(kind = 'spotify', force = false) {
  const c = detected[kind];
  if (!force && c && Date.now() - c.at < 5 * 60 * 1000) return Promise.resolve(c.result);
  const { bin } = TOOLS[kind];
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      const result = err
        ? { available: false, error: err.code === 'ENOENT' ? `"${bin}" não encontrado no servidor` : String(stderr || err.message).trim().slice(0, 300) }
        : { available: true, version: String(stdout).trim().split(/\s+/).pop() };
      detected[kind] = { result, at: Date.now() };
      resolve(result);
    });
  });
}

/** Aceita links open.spotify.com (faixa, álbum, playlist, artista) e URIs spotify:tipo:id; devolve o link canônico. */
function spotifyUrl(v) {
  const s = String(v || '').trim();
  const m = s.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{22})(?:[/?#].*)?$/)
    || s.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/);
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null;
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n');
const clip = (v, max) => (typeof v === 'string' && v.length > max ? v.slice(0, max) : v);

async function genreIds(name) {
  if (!name) return [];
  const g = await one(`SELECT id FROM genres WHERE kind = 'genre' AND f_norm(name) = f_norm($1)`, [name]);
  return g ? [g.id] : [];
}

/** Coloca um arquivo baixado pelo spotDL no catálogo. Devolve o item para o histórico do job. */
async function ingest(job, file) {
  const name = path.basename(file);
  const up = uuidv7();
  const tmp = path.join(TMP_DIR, up);
  fs.renameSync(file, tmp);
  try {
    const { meta: m } = await probeAudio({ path: tmp, filename: up, originalname: name, size: fs.statSync(tmp).size });
    const artists = (m.artists.length ? m.artists : [m.album_artist || 'Artista desconhecido']).map((a) => clip(a, 200));
    const { id, title } = await createTrack({
      source: 'file', upload_id: up, title: clip(m.title, 200), artists, composers: m.composers.map((a) => clip(a, 200)),
      album_title: clip(m.album, 200), release_date: m.date || (m.year ? `${m.year}-01-01` : null), label: clip(m.label, 200),
      track_number: m.track_number, disc_number: m.disc_number || 1, isrc: m.isrc, lyrics: clip(m.lyrics, 20000), cover_url: m.cover_url,
      genre_ids: await genreIds(m.genre),
    }, job.created_by);
    await audit({ user: { id: job.created_by }, ip: null }, 'admin.track_create', 'track', id, { title, source: 'file', via: 'spotdl', job: job.id });
    return { file: name, status: 'imported', title, track_id: id };
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}.json`, { force: true });
    const dup = e instanceof HttpError && (e.code === 'ISRC_TAKEN' || e.code === 'DUPLICATE_AUDIO');
    if (!(e instanceof HttpError)) console.error(`[spotdl] ${name}:`, e);
    return { file: name, status: dup ? 'skipped' : 'failed', message: e instanceof HttpError ? e.message : 'Erro interno ao gravar a faixa' };
  }
}

/** Troca o áudio da faixa do YouTube pelo arquivo baixado pelo yt-dlp (mesmo id). */
async function attachAudio(job, file) {
  const name = path.basename(file);
  const up = uuidv7();
  const tmp = path.join(TMP_DIR, up);
  fs.renameSync(file, tmp);
  let dest = null;
  try {
    const info = await probeAudio({ path: tmp, filename: up, originalname: name, size: fs.statSync(tmp).size });
    const audioName = `${job.track_id}.${MIME_EXT[info.mime] || 'bin'}`;
    const checksum = sha256(fs.readFileSync(tmp));
    dest = path.join(AUDIO_DIR, audioName);
    fs.renameSync(tmp, dest);
    const t = await one(
      `UPDATE tracks SET source = 'file', audio_path = $2, audio_mime = $3, audio_size = $4, checksum = $5, bitrate_kbps = $6, duration_ms = $7
        WHERE id = $1 AND source = 'youtube' RETURNING title`,
      [job.track_id, audioName, info.mime, info.size, checksum, info.meta.bitrate_kbps, info.meta.duration_ms]
    );
    if (!t) throw bad('A faixa não existe mais ou já tem áudio próprio');
    dest = null;
    await audit({ user: { id: job.created_by }, ip: null }, 'track.youtube_fetch', 'track', job.track_id, { title: t.title, job: job.id });
    return { file: name, status: 'imported', title: t.title, track_id: job.track_id };
  } catch (e) {
    if (dest) fs.rmSync(dest, { force: true });
    if (!(e instanceof HttpError)) console.error(`[yt-dlp] ${name}:`, e);
    return { file: name, status: 'failed', message: e instanceof HttpError ? e.message : 'Erro interno ao gravar o áudio' };
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}.json`, { force: true });
  }
}

const jobArgs = (job, dir) => (job.kind === 'youtube'
  ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--no-playlist', '--newline', '-o', path.join(dir, '%(id)s.%(ext)s'), ...TOOLS.youtube.extra, job.url]
  : ['download', job.url, '--output', path.join(dir, '{artists} - {title}.{output-ext}'), '--format', 'mp3', '--simple-tui', '--print-errors', ...TOOLS.spotify.extra]);

const running = new Map(); // job id -> processo filho, dos jobs rodando nesta réplica

async function runJob(job) {
  const tool = TOOLS[job.kind];
  const dir = path.join(TMP_DIR, `job-${job.id}`);
  fs.mkdirSync(dir, { recursive: true });
  let log = '';
  let canceled = false;
  const items = [];
  /** Grava progresso e log; com `end`, fecha o job (status null = mantém, ex.: cancelado). */
  const save = async (end) => {
    const r = await one(
      `UPDATE import_jobs SET log = $2, items = $3, imported = $4, skipped = $5, failed = $6, updated_at = now(),
              status = CASE WHEN $7::boolean AND $8::text IS NOT NULL AND status = 'running' THEN $8 ELSE status END,
              error = CASE WHEN $7::boolean AND status = 'running' THEN $9 ELSE error END,
              finished_at = CASE WHEN $7::boolean THEN now() ELSE finished_at END
        WHERE id = $1 RETURNING status`,
      [job.id, log, JSON.stringify(items), ...['imported', 'skipped', 'failed'].map((s) => items.filter((i) => i.status === s).length),
        !!end, end?.status || null, end?.error || null]
    );
    if (r?.status === 'canceled') canceled = true;
  };
  const heartbeat = setInterval(() => {
    save().then(() => { if (canceled) running.get(job.id)?.kill(); }).catch((e) => console.error('[import]', e.message));
  }, 5000);
  try {
    const code = await new Promise((resolve) => {
      const child = spawn(tool.bin, jobArgs(job, dir), { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
      running.set(job.id, child);
      const add = (d) => { log = (log + stripAnsi(d.toString('utf8'))).slice(-LOG_MAX); };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const timer = setTimeout(() => { add('\n[KeshTune] Tempo limite atingido; processo encerrado.\n'); child.kill(); }, JOB_TIMEOUT_MS);
      child.on('error', (e) => { add(`\n${e.message}\n`); clearTimeout(timer); resolve(null); });
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
    });
    const files = fs.readdirSync(dir).filter((f) => AUDIO_EXT.test(f)).sort();
    if (!canceled) {
      for (const f of job.kind === 'youtube' ? files.slice(0, 1) : files) {
        items.push(await (job.kind === 'youtube' ? attachAudio : ingest)(job, path.join(dir, f)));
        await save();
        if (canceled) break;
      }
    }
    const error = canceled ? null
      : !files.length ? `O ${tool.name} não baixou nenhuma faixa (código ${code}). Veja o log.`
        : job.kind === 'youtube' && items[0]?.status !== 'imported' ? items[0]?.message || 'Falha ao gravar o áudio' : null;
    await save({ status: canceled ? null : error ? 'failed' : 'done', error });
  } finally {
    clearInterval(heartbeat);
    running.delete(job.id);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Duas pistas: a normal pega qualquer job pela ordem; a expressa só pega faixa do YouTube urgente
// (alguém esperando para ouvir), para ela não ficar atrás de uma importação longa que já está rodando.
const URGENT_SQL = `kind = 'youtube' AND created_at < now() - interval '50 years'`;
const lanes = { normal: { busy: false, where: 'true' }, urgent: { busy: false, where: URGENT_SQL } };

/** Pega o próximo job da fila (seguro com várias réplicas: FOR UPDATE SKIP LOCKED). */
async function tick() {
  await Promise.all([runLane(lanes.normal), runLane(lanes.urgent)]);
}

async function runLane(lane) {
  if (lane.busy) return;
  lane.busy = true;
  try {
    // Job sem sinal de vida há 2 min: a réplica que rodava caiu
    await q(`UPDATE import_jobs SET status = 'failed', error = 'Interrompido (o servidor reiniciou durante a importação)', finished_at = now()
              WHERE status = 'running' AND updated_at < now() - interval '2 minutes'`);
    for (;;) {
      const job = await one(
        `UPDATE import_jobs SET status = 'running', started_at = now(), updated_at = now()
          WHERE id = (SELECT id FROM import_jobs WHERE status = 'queued' AND ${lane.where} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`
      );
      if (!job) break;
      try {
        await runJob(job);
      } catch (e) {
        console.error('[import] job', job.id, e);
        await q(`UPDATE import_jobs SET status = 'failed', error = 'Erro interno na importação', finished_at = now() WHERE id = $1 AND status = 'running'`, [job.id]);
      }
    }
  } catch (e) {
    console.error('[import]', e.message);
  } finally {
    lane.busy = false;
  }
}

/** Coloca um job na fila e acorda o worker. */
export async function enqueueJob({ kind, url, trackId = null, userId, urgent = false }) {
  const id = uuidv7();
  // urgent: alguém está esperando para ouvir (app nativo) → passa à frente da fila (o worker pega pelo created_at)
  await q(`INSERT INTO import_jobs (id, kind, url, track_id, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5, CASE WHEN $6 THEN now() - interval '100 years' ELSE now() END)`, [id, kind, url, trackId, userId, urgent]);
  setImmediate(tick);
  return id;
}

export function startImportWorker() {
  setInterval(tick, 15000).unref();
  tick();
}

// ---------------- Rotas (admin) ----------------
export const importsRouter = express.Router();
importsRouter.use('/admin/imports', auth(), adminOnly);

export const JOB_COLS = `id, kind, url, track_id, status, imported, skipped, failed, error, created_at, started_at, finished_at,
  (SELECT display_name FROM users u WHERE u.id = import_jobs.created_by) AS created_by_name`;

importsRouter.get('/admin/imports/status', ah(async (req, res) => {
  res.json(await detect('spotify', req.query.refresh === '1'));
}));

importsRouter.get('/admin/imports', ah(async (_req, res) => {
  res.json({ items: await q(`SELECT ${JOB_COLS} FROM import_jobs ORDER BY created_at DESC LIMIT 50`) });
}));

importsRouter.get('/admin/imports/:id', ah(async (req, res) => {
  const j = await one(`SELECT ${JOB_COLS}, items, log FROM import_jobs WHERE id = $1`, [uuidParam(req.params.id)]);
  if (!j) throw notFound('Importação não encontrada');
  res.json(j);
}));

importsRouter.post('/admin/imports', ah(async (req, res) => {
  const url = spotifyUrl(req.body?.url);
  if (!url) throw bad('Link do Spotify inválido (use um link de faixa, álbum, playlist ou artista)');
  if (!(await detect('spotify')).available) throw bad('O spotDL não está instalado no servidor', 'SPOTDL_UNAVAILABLE');
  if (await one(`SELECT 1 FROM import_jobs WHERE url = $1 AND status IN ('queued','running')`, [url])) {
    throw new HttpError(409, 'IMPORT_PENDING', 'Este link já está na fila');
  }
  const id = await enqueueJob({ kind: 'spotify', url, userId: req.user.id });
  await audit(req, 'admin.import_create', 'import', id, { url });
  res.status(201).json(await one(`SELECT ${JOB_COLS} FROM import_jobs WHERE id = $1`, [id]));
}));

importsRouter.post('/admin/imports/:id/cancel', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const r = await q(`UPDATE import_jobs SET status = 'canceled', finished_at = CASE WHEN status = 'queued' THEN now() END
                      WHERE id = $1 AND status IN ('queued','running') RETURNING id`, [id]);
  if (!r.length) throw bad('A importação já terminou');
  running.get(id)?.kill();
  await audit(req, 'admin.import_cancel', 'import', id);
  res.json({ ok: true });
}));
