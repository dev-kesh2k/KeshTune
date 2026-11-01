import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { parseFile } from 'music-metadata';
import { one, q, tx } from '../db.js';
import { adminOnly, audit, auth, forgetUser, hashPassword, tempPassword } from '../security.js';
import { getSettings } from '../seed.js';
import { emit } from '../realtime.js';
import {
  ah, bad, csvEscape, dateStr, HttpError, int, isEmail, notFound, oneOf, parseCsv, str, uuidParam, uuidv7,
} from '../util.js';
import { restrictUser } from './auth.js';
import { AUDIO_DIR, isImageRef, saveImage, TMP_DIR } from './media.js';

export const adminRouter = express.Router();
adminRouter.use('/admin', auth(), adminOnly);

const ah2 = ah;

// ---------------- Painel ----------------
adminRouter.get('/admin/stats', ah2(async (_req, res) => {
  const stats = await one(`SELECT
      (SELECT count(*) FROM users WHERE deleted_at IS NULL)::int AS users,
      (SELECT count(*) FROM users WHERE deleted_at IS NULL AND status = 'blocked')::int AS blocked_users,
      (SELECT count(*) FROM tracks WHERE status = 'active')::int AS tracks,
      (SELECT count(*) FROM tracks WHERE status = 'active' AND source = 'youtube')::int AS youtube_tracks,
      (SELECT count(*) FROM tracks WHERE status = 'takedown')::int AS takedown_tracks,
      (SELECT count(*) FROM artists)::int AS artists,
      (SELECT count(*) FROM albums)::int AS albums,
      (SELECT count(*) FROM playlists WHERE deleted_at IS NULL)::int AS playlists,
      (SELECT COALESCE(sum(audio_size), 0) FROM tracks WHERE audio_size IS NOT NULL)::bigint AS storage_bytes,
      (SELECT COALESCE(sum(plays), 0) FROM play_counts WHERE day = current_date)::int AS plays_today,
      (SELECT COALESCE(sum(plays), 0) FROM play_counts WHERE day > current_date - 30)::int AS plays_30d,
      (SELECT count(DISTINCT user_id) FROM play_history WHERE played_at > now() - interval '30 days')::int AS active_users_30d,
      (SELECT count(*) FROM devices WHERE revoked_at IS NULL)::int AS devices,
      (SELECT count(*) FROM offline_licenses WHERE revoked_at IS NULL AND expires_at > now())::int AS offline_licenses`);
  const daily = await q(
    `SELECT d::date AS day, COALESCE((SELECT sum(plays) FROM play_counts pc WHERE pc.day = d::date), 0)::int AS plays
       FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`
  );
  const top = await q(
    `SELECT t.id, t.title, sum(pc.plays)::int AS plays,
            (SELECT string_agg(a.name, ', ') FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id AND ta.role = 'main') AS artists
       FROM play_counts pc JOIN tracks t ON t.id = pc.track_id WHERE pc.day > current_date - 30
      GROUP BY t.id ORDER BY plays DESC LIMIT 10`
  );
  res.json({ ...stats, daily, top });
}));

// ---------------- Contas ----------------
const USER_COLS = `id, email, display_name, role, status, must_change_password, totp_enabled, created_at, locked_until,
  (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = users.id) AS last_seen_at,
  (SELECT count(*) FROM devices d WHERE d.user_id = users.id AND d.revoked_at IS NULL)::int AS devices`;

adminRouter.get('/admin/users', ah2(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 100);
  const status = oneOf(req.query.status, 'status', ['active', 'blocked', 'all'], 'all');
  const rows = await q(
    `SELECT ${USER_COLS} FROM users WHERE deleted_at IS NULL
        AND ($1 = '' OR f_norm(display_name) LIKE '%' || f_norm($1) || '%' OR lower(email) LIKE '%' || lower($1) || '%')
        AND ($2 = 'all' OR status = $2)
      ORDER BY created_at DESC LIMIT 500`,
    [term, status]
  );
  res.json({ items: rows });
}));

async function createUser(req, { email, display_name, role }) {
  if (!isEmail(email)) throw bad(`E-mail inválido: ${email}`);
  const exists = await one(`SELECT 1 FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [email]);
  if (exists) throw new HttpError(409, 'EMAIL_TAKEN', `Já existe uma conta com o e-mail ${email}`);
  const pw = tempPassword();
  const id = uuidv7();
  await q(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_by, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [id, email.toLowerCase(), await hashPassword(pw), display_name, role, req.user.id]
  );
  await audit(req, 'admin.user_create', 'user', id, { email, role });
  return { id, email: email.toLowerCase(), display_name, role, temp_password: pw };
}

adminRouter.post('/admin/users', ah2(async (req, res) => {
  const b = req.body || {};
  res.status(201).json(await createUser(req, {
    email: str(b.email, 'E-mail', { required: true, max: 254 }),
    display_name: str(b.display_name, 'Nome', { required: true, min: 2, max: 80 }),
    role: oneOf(b.role, 'Perfil', ['user', 'admin'], 'user'),
  }));
}));

/** Importação em lote (CSV com nome e e-mail) — mitigação do risco "criar contas vira gargalo". */
adminRouter.post('/admin/users/import', ah2(async (req, res) => {
  const text = String(req.body?.csv || '');
  const rows = parseCsv(text);
  if (!rows.length) throw bad('CSV vazio');
  const start = rows[0].some((c) => /e-?mail/i.test(c)) ? 1 : 0;
  if (rows.length - start > 500) throw bad('No máximo 500 contas por importação');
  const created = [];
  const errors = [];
  for (const r of rows.slice(start)) {
    const cells = r.map((c) => c.trim());
    const email = cells.find((c) => c.includes('@')) || '';
    const name = cells.find((c) => c && !c.includes('@')) || email.split('@')[0];
    try {
      created.push(await createUser(req, { email, display_name: name.slice(0, 80), role: 'user' }));
    } catch (e) {
      errors.push({ email, error: e.message });
    }
  }
  res.status(201).json({ created, errors });
}));

adminRouter.get('/admin/users/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const u = await one(`SELECT ${USER_COLS}, failed_logins FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!u) throw notFound('Conta não encontrada');
  const sessions = await q(`SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [id]);
  const devices = await q(
    `SELECT d.id, d.name, d.platform, d.last_seen_at,
            (SELECT count(*) FROM offline_licenses l WHERE l.device_id = d.id AND l.revoked_at IS NULL AND l.expires_at > now())::int AS licenses
       FROM devices d WHERE d.user_id = $1 AND d.revoked_at IS NULL`,
    [id]
  );
  const usage = await one(
    `SELECT (SELECT count(*) FROM playlists WHERE owner_id = $1 AND deleted_at IS NULL)::int AS playlists,
            (SELECT count(*) FROM play_history WHERE user_id = $1)::int AS plays,
            (SELECT count(*) FROM library_items WHERE user_id = $1 AND item_type = 'track')::int AS liked`,
    [id]
  );
  res.json({ ...u, sessions, devices, usage });
}));

adminRouter.patch('/admin/users/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const u = await one(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!u) throw notFound('Conta não encontrada');
  const b = req.body || {};
  const sets = [];
  const vals = [id];
  const set = (c, v) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if (b.display_name !== undefined) set('display_name', str(b.display_name, 'Nome', { required: true, min: 2, max: 80 }));
  if (b.email !== undefined) {
    const email = str(b.email, 'E-mail', { required: true, max: 254 }).toLowerCase();
    if (!isEmail(email)) throw bad('E-mail inválido');
    const dup = await one(`SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 AND deleted_at IS NULL`, [email, id]);
    if (dup) throw new HttpError(409, 'EMAIL_TAKEN', 'E-mail já usado por outra conta');
    set('email', email);
  }
  const demoting = (b.role !== undefined && b.role !== 'admin' && u.role === 'admin') || (b.status === 'blocked' && u.role === 'admin');
  if (demoting) {
    if (id === req.user.id) throw bad('Você não pode remover o próprio acesso de administrador');
    const { n } = await one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL`);
    if (n <= 1) throw bad('É preciso manter ao menos um administrador ativo');
  }
  if (b.role !== undefined) set('role', oneOf(b.role, 'Perfil', ['user', 'admin']));
  if (b.status !== undefined) {
    if (id === req.user.id && b.status === 'blocked') throw bad('Você não pode bloquear a própria conta');
    set('status', oneOf(b.status, 'Situação', ['active', 'blocked']));
  }
  if (!sets.length) throw bad('Nada para alterar');
  await q(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
  forgetUser(id);
  if (b.status === 'blocked') await restrictUser(id);
  await audit(req, b.status === 'blocked' ? 'admin.user_block' : b.status === 'active' ? 'admin.user_unblock' : 'admin.user_update', 'user', id, b);
  res.json(await one(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]));
}));

adminRouter.post('/admin/users/:id/reset-password', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const u = await one(`SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!u) throw notFound('Conta não encontrada');
  const pw = tempPassword();
  await q(`UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1`, [id, await hashPassword(pw)]);
  await q(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
  forgetUser(id);
  await audit(req, 'admin.user_reset_password', 'user', id);
  res.json({ email: u.email, temp_password: pw });
}));

adminRouter.post('/admin/users/:id/unlock', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  await q(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [id]);
  await audit(req, 'admin.user_unlock', 'user', id);
  res.json({ ok: true });
}));

adminRouter.post('/admin/users/:id/disable-2fa', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  await q(`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1`, [id]);
  await audit(req, 'admin.user_disable_2fa', 'user', id);
  res.json({ ok: true });
}));

adminRouter.delete('/admin/users/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  if (id === req.user.id) throw bad('Para excluir a própria conta use Configurações');
  const u = await one(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!u) throw notFound('Conta não encontrada');
  if (u.role === 'admin') {
    const { n } = await one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL`);
    if (n <= 1) throw bad('É preciso manter ao menos um administrador ativo');
  }
  await q(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
  await q(`UPDATE playlists SET deleted_at = now() WHERE owner_id = $1 AND deleted_at IS NULL`, [id]);
  await restrictUser(id);
  await audit(req, 'admin.user_delete', 'user', id);
  res.json({ ok: true });
}));

// ---------------- Catálogo: envio de áudio ----------------
const audioUpload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: (_r, _f, cb) => cb(null, uuidv7()) }),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
});
const CONTAINER_MIME = { MPEG: 'audio/mpeg', 'MPEG-4': 'audio/mp4', Ogg: 'audio/ogg', WAVE: 'audio/wav', FLAC: 'audio/flac', 'EBML/webm': 'audio/webm', 'EBML/matroska': 'audio/webm' };
const MIME_EXT = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/webm': 'webm' };

setInterval(() => {
  try {
    for (const f of fs.readdirSync(TMP_DIR)) {
      const p = path.join(TMP_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { force: true });
    }
  } catch { /* */ }
}, 3600 * 1000).unref();

adminRouter.post('/admin/uploads/audio', audioUpload.single('file'), ah2(async (req, res) => {
  if (!req.file) throw bad('Envie o arquivo de áudio no campo "file"');
  let meta;
  try {
    meta = await parseFile(req.file.path, { duration: true, skipCovers: false });
  } catch {
    fs.rmSync(req.file.path, { force: true });
    throw bad('Arquivo de áudio inválido ou corrompido');
  }
  const mime = CONTAINER_MIME[meta.format.container] || (meta.format.container?.includes('M4A') || meta.format.container?.includes('isom') ? 'audio/mp4' : null);
  if (!mime || !meta.format.duration) {
    fs.rmSync(req.file.path, { force: true });
    throw bad(`Formato não suportado (${meta.format.container || 'desconhecido'}). Use MP3, AAC/M4A, OGG/Opus, FLAC ou WAV.`);
  }
  const c = meta.common;
  let cover_url = null;
  const pic = c.picture?.[0];
  if (pic?.data) {
    try { cover_url = saveImage(Buffer.from(pic.data)); } catch { /* capa embutida em formato não suportado */ }
  }
  const lyrics = Array.isArray(c.lyrics) && c.lyrics.length
    ? c.lyrics.map((l) => (typeof l === 'string' ? l : l.text || (l.syncText || []).map((s) => s.text).join('\n'))).filter(Boolean).join('\n')
    : null;
  const info = {
    upload_id: req.file.filename,
    original_name: req.file.originalname,
    mime,
    size: req.file.size,
    meta: {
      title: c.title || req.file.originalname.replace(/\.[^.]+$/, ''),
      artists: c.artists?.length ? c.artists : c.artist ? [c.artist] : [],
      album: c.album || null,
      album_artist: c.albumartist || null,
      year: c.year || null,
      date: c.date && /^\d{4}-\d{2}-\d{2}/.test(c.date) ? c.date.slice(0, 10) : null,
      track_number: c.track?.no || null,
      disc_number: c.disk?.no || null,
      isrc: Array.isArray(c.isrc) ? c.isrc[0] : c.isrc || null,
      genre: c.genre?.[0] || null,
      composers: c.composer || [],
      label: c.label?.[0] || null,
      lyrics,
      duration_ms: Math.round(meta.format.duration * 1000),
      bitrate_kbps: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
      cover_url,
    },
  };
  fs.writeFileSync(`${req.file.path}.json`, JSON.stringify({ mime, size: req.file.size, bitrate_kbps: info.meta.bitrate_kbps, duration_ms: info.meta.duration_ms }));
  res.status(201).json(info);
}));

function youtubeId(url) {
  const s = String(url || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/);
  return m ? m[1] : null;
}

adminRouter.post('/admin/youtube/lookup', ah2(async (req, res) => {
  const vid = youtubeId(req.body?.url);
  if (!vid) throw bad('Link do YouTube inválido');
  let data = null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) data = await r.json();
  } catch { /* sem rede */ }
  if (!data) throw bad('Vídeo não encontrado ou não permite incorporação');
  res.json({
    youtube_id: vid,
    title: data.title,
    author_name: String(data.author_name || '').replace(/\s*-\s*Topic$/i, ''),
    thumbnail_url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
  });
}));

// ---------------- Catálogo: faixas ----------------
async function findOrCreateArtist(db, name) {
  const n = str(name, 'Artista', { required: true, max: 200 });
  const ex = await db.one(`SELECT id FROM artists WHERE f_norm(name) = f_norm($1) ORDER BY created_at LIMIT 1`, [n]);
  if (ex) return ex.id;
  const id = uuidv7();
  await db.q(`INSERT INTO artists (id, name) VALUES ($1,$2)`, [id, n]);
  return id;
}
async function resolveArtists(db, list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a) continue;
    if (typeof a === 'object' && a.id) {
      const ex = await db.one(`SELECT id FROM artists WHERE id = $1`, [uuidParam(a.id, 'artista')]);
      if (!ex) throw bad('Artista não encontrado');
      out.push(ex.id);
    } else out.push(await findOrCreateArtist(db, typeof a === 'object' ? a.name : a));
  }
  return [...new Set(out)];
}

async function saveTrackRelations(db, trackId, b) {
  const main = await resolveArtists(db, b.artists);
  if (!main.length) throw bad('Informe ao menos um artista principal');
  const featured = (await resolveArtists(db, b.featured)).filter((x) => !main.includes(x));
  const composers = await resolveArtists(db, b.composers);
  const producers = await resolveArtists(db, b.producers);
  await db.q(`DELETE FROM track_artists WHERE track_id = $1`, [trackId]);
  const add = async (ids, role) => {
    for (const [i, a] of ids.entries()) await db.q(`INSERT INTO track_artists (track_id, artist_id, role, position) VALUES ($1,$2,$3,$4)`, [trackId, a, role, i]);
  };
  await add(main, 'main');
  await add(featured, 'featured');
  await add(composers, 'composer');
  await add(producers, 'producer');
  await db.q(`DELETE FROM track_genres WHERE track_id = $1`, [trackId]);
  for (const g of Array.isArray(b.genre_ids) ? b.genre_ids.slice(0, 10) : []) {
    const gid = int(g, 'gênero', { min: 1 });
    await db.q(`INSERT INTO track_genres (track_id, genre_id) SELECT $1, id FROM genres WHERE id = $2 ON CONFLICT DO NOTHING`, [trackId, gid]);
  }
  return main;
}

async function resolveAlbum(db, b, mainArtists) {
  if (b.album_id) {
    const al = await db.one(`SELECT id FROM albums WHERE id = $1`, [uuidParam(b.album_id, 'álbum')]);
    if (!al) throw bad('Álbum não encontrado');
    return al.id;
  }
  const title = str(b.album_title, 'Álbum', { max: 200 });
  if (!title) return null;
  const ex = await db.one(
    `SELECT al.id FROM albums al JOIN album_artists aa ON aa.album_id = al.id AND aa.artist_id = $2 WHERE f_norm(al.title) = f_norm($1) LIMIT 1`,
    [title, mainArtists[0]]
  );
  if (ex) return ex.id;
  const id = uuidv7();
  await db.q(`INSERT INTO albums (id, title, type, release_date, label, cover_url) VALUES ($1,$2,$3,$4,$5,$6)`, [
    id, title, oneOf(b.album_type, 'Tipo', ['album', 'single', 'ep', 'compilation'], 'album'), dateStr(b.release_date, 'Data de lançamento'),
    str(b.label, 'Gravadora', { max: 200 }), b.cover_url && isImageRef(b.cover_url) ? b.cover_url : null,
  ]);
  await db.q(`INSERT INTO album_artists (album_id, artist_id, position) VALUES ($1,$2,0)`, [id, mainArtists[0]]);
  return id;
}

function trackFields(b) {
  const isrc = str(b.isrc, 'ISRC', { max: 15 });
  if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc.replace(/-/g, '').toUpperCase())) throw bad('ISRC inválido (ex.: BRABC2400001)');
  if (b.cover_url && !isImageRef(b.cover_url)) throw bad('Capa inválida');
  return {
    title: str(b.title, 'Título', { required: true, max: 200 }),
    isrc: isrc ? isrc.replace(/-/g, '').toUpperCase() : null,
    explicit: !!b.explicit,
    track_number: int(b.track_number, 'Número da faixa', { min: 1, max: 999 }),
    disc_number: int(b.disc_number, 'Disco', { min: 1, max: 99 }) || 1,
    lyrics: str(b.lyrics, 'Letra', { max: 20000, trim: false }),
    cover_url: b.cover_url || null,
  };
}

const ADMIN_TRACK_SQL = `SELECT t.id, t.title, t.source, t.youtube_id, t.status, t.takedown_reason, t.duration_ms, t.isrc, t.explicit, t.track_number,
  t.disc_number, t.lyrics, t.cover_url, t.audio_size, t.audio_mime, t.bitrate_kbps, t.popularity, t.created_at,
  al.id AS album_id, al.title AS album_title, al.cover_url AS album_cover,
  COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'role', ta.role) ORDER BY ta.role, ta.position)
    FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id), '[]') AS credits,
  COALESCE((SELECT json_agg(tg.genre_id) FROM track_genres tg WHERE tg.track_id = t.id), '[]') AS genre_ids,
  (SELECT COALESCE(sum(plays), 0) FROM play_counts pc WHERE pc.track_id = t.id)::int AS plays
  FROM tracks t LEFT JOIN albums al ON al.id = t.album_id`;

adminRouter.get('/admin/tracks', ah2(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 100);
  const status = oneOf(req.query.status, 'status', ['active', 'takedown', 'all'], 'all');
  const rows = await q(
    `${ADMIN_TRACK_SQL}
      WHERE ($1 = '' OR f_norm(t.title) LIKE '%' || f_norm($1) || '%'
             OR EXISTS (SELECT 1 FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id AND f_norm(a.name) LIKE '%' || f_norm($1) || '%'))
        AND ($2 = 'all' OR t.status = $2)
      ORDER BY t.created_at DESC LIMIT 300`,
    [term, status]
  );
  res.json({ items: rows });
}));

adminRouter.get('/admin/tracks/:id', ah2(async (req, res) => {
  const t = await one(`${ADMIN_TRACK_SQL} WHERE t.id = $1`, [uuidParam(req.params.id)]);
  if (!t) throw notFound('Faixa não encontrada');
  res.json(t);
}));

adminRouter.post('/admin/tracks', ah2(async (req, res) => {
  const b = req.body || {};
  const source = oneOf(b.source, 'Fonte', ['file', 'youtube']);
  const f = trackFields(b);
  let file = null;
  let ytId = null;
  if (source === 'file') {
    const up = String(b.upload_id || '');
    if (!/^[0-9a-f-]{36}$/.test(up) || !fs.existsSync(path.join(TMP_DIR, up))) throw bad('Envie o arquivo de áudio novamente (envio expirado)');
    file = { id: up, ...JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${up}.json`), 'utf8')) };
  } else {
    const s = await getSettings();
    if (!s.youtube_enabled) throw bad('Faixas do YouTube estão desativadas nas configurações');
    ytId = youtubeId(b.youtube_url || b.youtube_id);
    if (!ytId) throw bad('Link do YouTube inválido');
  }
  if (f.isrc && (await one(`SELECT 1 FROM tracks WHERE isrc = $1`, [f.isrc]))) throw new HttpError(409, 'ISRC_TAKEN', 'Já existe uma faixa com este ISRC');
  const id = uuidv7();
  await tx(async (db) => {
    let checksum = null;
    let audioName = null;
    if (file) {
      audioName = `${id}.${MIME_EXT[file.mime] || 'bin'}`;
      const src = path.join(TMP_DIR, file.id);
      checksum = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
      const dup = await db.one(`SELECT title FROM tracks WHERE checksum = $1`, [checksum]);
      if (dup && !b.allow_duplicate) throw new HttpError(409, 'DUPLICATE_AUDIO', `Este áudio já está no catálogo ("${dup.title}")`);
    }
    await db.q(
      `INSERT INTO tracks (id, title, isrc, explicit, track_number, disc_number, lyrics, cover_url, source, youtube_id, audio_path, audio_mime,
                           audio_size, checksum, bitrate_kbps, duration_ms, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, f.title, f.isrc, f.explicit, f.track_number, f.disc_number, f.lyrics, f.cover_url, source, ytId, audioName, file?.mime || null,
        file?.size || null, checksum, file?.bitrate_kbps || null, file ? file.duration_ms : int(b.duration_ms, 'Duração', { min: 0 }) || 0, req.user.id]
    );
    const main = await saveTrackRelations(db, id, b);
    const albumId = await resolveAlbum(db, b, main);
    if (albumId) await db.q(`UPDATE tracks SET album_id = $2 WHERE id = $1`, [id, albumId]);
    if (file) {
      fs.renameSync(path.join(TMP_DIR, file.id), path.join(AUDIO_DIR, audioName));
      fs.rmSync(path.join(TMP_DIR, `${file.id}.json`), { force: true });
    }
  });
  await audit(req, 'admin.track_create', 'track', id, { title: f.title, source });
  res.status(201).json(await one(`${ADMIN_TRACK_SQL} WHERE t.id = $1`, [id]));
}));

adminRouter.patch('/admin/tracks/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const cur = await one(`SELECT * FROM tracks WHERE id = $1`, [id]);
  if (!cur) throw notFound('Faixa não encontrada');
  const b = { ...req.body };
  const f = trackFields({ ...cur, ...b, cover_url: b.cover_url !== undefined ? b.cover_url : cur.cover_url });
  if (f.isrc && f.isrc !== cur.isrc && (await one(`SELECT 1 FROM tracks WHERE isrc = $1 AND id <> $2`, [f.isrc, id]))) {
    throw new HttpError(409, 'ISRC_TAKEN', 'Já existe uma faixa com este ISRC');
  }
  await tx(async (db) => {
    await db.q(
      `UPDATE tracks SET title = $2, isrc = $3, explicit = $4, track_number = $5, disc_number = $6, lyrics = $7, cover_url = $8,
              duration_ms = CASE WHEN source = 'youtube' AND $9::int IS NOT NULL THEN $9 ELSE duration_ms END WHERE id = $1`,
      [id, f.title, f.isrc, f.explicit, f.track_number, f.disc_number, f.lyrics, f.cover_url, int(b.duration_ms, 'Duração', { min: 0 })]
    );
    if (b.artists !== undefined) {
      const main = await saveTrackRelations(db, id, b);
      if (b.album_id !== undefined || b.album_title !== undefined) {
        await db.q(`UPDATE tracks SET album_id = $2 WHERE id = $1`, [id, await resolveAlbum(db, b, main)]);
      }
    }
  });
  await audit(req, 'admin.track_update', 'track', id, { title: f.title });
  res.json(await one(`${ADMIN_TRACK_SQL} WHERE t.id = $1`, [id]));
}));

/** Notificação e retirada: tira a faixa do ar (com motivo) ou devolve ao catálogo. */
adminRouter.patch('/admin/takedown/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const takedown = req.body?.takedown !== false;
  const reason = str(req.body?.reason, 'Motivo', { max: 500 });
  if (takedown && !reason) throw bad('Informe o motivo da retirada');
  const r = await q(`UPDATE tracks SET status = $2, takedown_reason = $3 WHERE id = $1 RETURNING id`, [id, takedown ? 'takedown' : 'active', takedown ? reason : null]);
  if (!r.length) throw notFound('Faixa não encontrada');
  if (takedown) {
    const users = await q(`SELECT DISTINCT user_id FROM offline_licenses WHERE track_id = $1 AND revoked_at IS NULL`, [id]);
    if (users.length) await emit('download.revoked', { track_id: id }, users.map((u) => u.user_id));
  }
  await audit(req, takedown ? 'admin.takedown' : 'admin.restore_track', 'track', id, { reason });
  res.json({ ok: true });
}));

adminRouter.delete('/admin/tracks/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const t = await one(`SELECT title, audio_path FROM tracks WHERE id = $1`, [id]);
  if (!t) throw notFound('Faixa não encontrada');
  await q(`DELETE FROM tracks WHERE id = $1`, [id]);
  if (t.audio_path) fs.rmSync(path.join(AUDIO_DIR, path.basename(t.audio_path)), { force: true });
  await audit(req, 'admin.track_delete', 'track', id, { title: t.title });
  res.json({ ok: true });
}));

// ---------------- Catálogo: artistas e álbuns ----------------
adminRouter.get('/admin/artists', ah2(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 100);
  res.json({
    items: await q(
      `SELECT a.*, (SELECT count(*) FROM track_artists ta WHERE ta.artist_id = a.id)::int AS track_count FROM artists a
        WHERE $1 = '' OR f_norm(a.name) LIKE '%' || f_norm($1) || '%' ORDER BY a.name LIMIT 500`,
      [term]
    ),
  });
}));
function artistFields(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) out.name = str(b.name, 'Nome', { required: true, max: 200 });
  if (!partial || b.bio !== undefined) out.bio = str(b.bio, 'Bio', { max: 5000, trim: false });
  if (!partial || b.image_url !== undefined) {
    if (b.image_url && !isImageRef(b.image_url)) throw bad('Imagem inválida');
    out.image_url = b.image_url || null;
  }
  if (!partial || b.verified !== undefined) out.verified = !!b.verified;
  if (!partial || b.country !== undefined) {
    const c = str(b.country, 'País', { max: 2 });
    if (c && !/^[A-Za-z]{2}$/.test(c)) throw bad('País deve ter 2 letras (ex.: BR)');
    out.country = c ? c.toUpperCase() : null;
  }
  return out;
}
adminRouter.post('/admin/artists', ah2(async (req, res) => {
  const f = artistFields(req.body || {});
  const id = uuidv7();
  await q(`INSERT INTO artists (id, name, bio, image_url, verified, country) VALUES ($1,$2,$3,$4,$5,$6)`, [id, f.name, f.bio, f.image_url, f.verified, f.country]);
  await audit(req, 'admin.artist_create', 'artist', id, { name: f.name });
  res.status(201).json(await one(`SELECT * FROM artists WHERE id = $1`, [id]));
}));
adminRouter.patch('/admin/artists/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const f = artistFields(req.body || {}, true);
  const keys = Object.keys(f);
  if (!keys.length) throw bad('Nada para alterar');
  const r = await q(`UPDATE artists SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => f[k])]);
  if (!r.length) throw notFound('Artista não encontrado');
  await audit(req, 'admin.artist_update', 'artist', id, f);
  res.json(r[0]);
}));
adminRouter.delete('/admin/artists/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { n } = await one(`SELECT count(*)::int AS n FROM track_artists WHERE artist_id = $1`, [id]);
  if (n) throw bad(`O artista tem ${n} faixa(s); remova ou reatribua antes`);
  await q(`DELETE FROM artists WHERE id = $1`, [id]);
  await q(`DELETE FROM library_items WHERE item_type = 'artist' AND item_id = $1`, [id]);
  await audit(req, 'admin.artist_delete', 'artist', id);
  res.json({ ok: true });
}));

adminRouter.get('/admin/albums', ah2(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 100);
  res.json({
    items: await q(
      `SELECT al.*, COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name)) FROM album_artists aa JOIN artists a ON a.id = aa.artist_id WHERE aa.album_id = al.id), '[]') AS artists,
              (SELECT count(*) FROM tracks t WHERE t.album_id = al.id)::int AS track_count
         FROM albums al WHERE $1 = '' OR f_norm(al.title) LIKE '%' || f_norm($1) || '%' ORDER BY al.created_at DESC LIMIT 500`,
      [term]
    ),
  });
}));
function albumFields(b, partial = false) {
  const out = {};
  if (!partial || b.title !== undefined) out.title = str(b.title, 'Título', { required: true, max: 200 });
  if (!partial || b.type !== undefined) out.type = oneOf(b.type, 'Tipo', ['album', 'single', 'ep', 'compilation'], 'album');
  if (!partial || b.release_date !== undefined) out.release_date = dateStr(b.release_date, 'Data de lançamento');
  if (!partial || b.label !== undefined) out.label = str(b.label, 'Gravadora', { max: 200 });
  if (!partial || b.upc !== undefined) {
    const u = str(b.upc, 'UPC', { max: 20 });
    if (u && !/^\d{12,14}$/.test(u)) throw bad('UPC deve ter 12 a 14 dígitos');
    out.upc = u;
  }
  if (!partial || b.cover_url !== undefined) {
    if (b.cover_url && !isImageRef(b.cover_url)) throw bad('Capa inválida');
    out.cover_url = b.cover_url || null;
  }
  return out;
}
async function setAlbumArtists(db, id, artists) {
  if (artists === undefined) return;
  const ids = await resolveArtists(db, artists);
  if (!ids.length) throw bad('Informe o artista do álbum');
  await db.q(`DELETE FROM album_artists WHERE album_id = $1`, [id]);
  for (const [i, a] of ids.entries()) await db.q(`INSERT INTO album_artists (album_id, artist_id, position) VALUES ($1,$2,$3)`, [id, a, i]);
}
adminRouter.post('/admin/albums', ah2(async (req, res) => {
  const f = albumFields(req.body || {});
  const id = uuidv7();
  await tx(async (db) => {
    await db.q(`INSERT INTO albums (id, title, type, release_date, label, upc, cover_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, f.title, f.type, f.release_date, f.label, f.upc, f.cover_url]);
    await setAlbumArtists(db, id, req.body?.artists || []);
  });
  await audit(req, 'admin.album_create', 'album', id, { title: f.title });
  res.status(201).json(await one(`SELECT * FROM albums WHERE id = $1`, [id]));
}));
adminRouter.patch('/admin/albums/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  if (!(await one(`SELECT 1 FROM albums WHERE id = $1`, [id]))) throw notFound('Álbum não encontrado');
  const f = albumFields(req.body || {}, true);
  const keys = Object.keys(f);
  await tx(async (db) => {
    if (keys.length) await db.q(`UPDATE albums SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => f[k])]);
    await setAlbumArtists(db, id, req.body?.artists);
  });
  await audit(req, 'admin.album_update', 'album', id, f);
  res.json(await one(`SELECT * FROM albums WHERE id = $1`, [id]));
}));
adminRouter.delete('/admin/albums/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  await q(`DELETE FROM albums WHERE id = $1`, [id]); // faixas ficam sem álbum (ON DELETE SET NULL)
  await q(`DELETE FROM library_items WHERE item_type = 'album' AND item_id = $1`, [id]);
  await audit(req, 'admin.album_delete', 'album', id);
  res.json({ ok: true });
}));

// ---------------- Gêneros e humores ----------------
adminRouter.post('/admin/genres', ah2(async (req, res) => {
  const name = str(req.body?.name, 'Nome', { required: true, max: 60 });
  const kind = oneOf(req.body?.kind, 'Tipo', ['genre', 'mood'], 'genre');
  const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : '#7c5cff';
  const r = await q(`INSERT INTO genres (name, kind, color) VALUES ($1,$2,$3) ON CONFLICT (kind, name) DO NOTHING RETURNING *`, [name, kind, color]);
  if (!r.length) throw new HttpError(409, 'DUPLICATE', 'Já existe com esse nome');
  await audit(req, 'admin.genre_create', 'genre', r[0].id, { name, kind });
  res.status(201).json(r[0]);
}));
adminRouter.patch('/admin/genres/:id', ah2(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1, required: true });
  const name = str(req.body?.name, 'Nome', { required: true, max: 60 });
  const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : null;
  const r = await q(`UPDATE genres SET name = $2, color = COALESCE($3, color) WHERE id = $1 RETURNING *`, [id, name, color]);
  if (!r.length) throw notFound('Gênero não encontrado');
  res.json(r[0]);
}));
adminRouter.delete('/admin/genres/:id', ah2(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1, required: true });
  await q(`DELETE FROM genres WHERE id = $1`, [id]);
  await audit(req, 'admin.genre_delete', 'genre', id);
  res.json({ ok: true });
}));

// ---------------- Moderação de playlists ----------------
adminRouter.get('/admin/playlists', ah2(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 100);
  res.json({
    items: await q(
      `SELECT p.id, p.name, p.description, p.visibility, p.hidden_by_admin, p.updated_at, u.display_name AS owner_name, u.email AS owner_email,
              (SELECT count(*) FROM playlist_items pi WHERE pi.playlist_id = p.id)::int AS track_count,
              (SELECT count(*) FROM library_items li WHERE li.item_type = 'playlist' AND li.item_id = p.id AND li.user_id <> p.owner_id)::int AS followers
         FROM playlists p JOIN users u ON u.id = p.owner_id
        WHERE p.deleted_at IS NULL AND p.visibility <> 'private' AND ($1 = '' OR f_norm(p.name) LIKE '%' || f_norm($1) || '%')
        ORDER BY p.updated_at DESC LIMIT 300`,
      [term]
    ),
  });
}));
adminRouter.patch('/admin/playlists/:id', ah2(async (req, res) => {
  const id = uuidParam(req.params.id);
  const hidden = !!req.body?.hidden_by_admin;
  const r = await q(`UPDATE playlists SET hidden_by_admin = $2 WHERE id = $1 RETURNING id`, [id, hidden]);
  if (!r.length) throw notFound('Playlist não encontrada');
  await audit(req, hidden ? 'admin.playlist_hide' : 'admin.playlist_unhide', 'playlist', id, { reason: req.body?.reason || null });
  res.json({ ok: true });
}));

// ---------------- Relatório de reproduções (royalties) ----------------
adminRouter.get('/admin/reports/plays', ah2(async (req, res) => {
  const from = dateStr(req.query.from, 'Início') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = dateStr(req.query.to, 'Fim') || new Date().toISOString().slice(0, 10);
  const rows = await q(
    `SELECT t.id, t.title, t.isrc, t.source, al.title AS album, sum(pc.plays)::int AS plays,
            (SELECT string_agg(a.name, ', ' ORDER BY ta.position) FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id AND ta.role IN ('main','featured')) AS artists,
            (SELECT string_agg(a.name, ', ') FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id AND ta.role = 'composer') AS composers
       FROM play_counts pc JOIN tracks t ON t.id = pc.track_id LEFT JOIN albums al ON al.id = t.album_id
      WHERE pc.day BETWEEN $1 AND $2 GROUP BY t.id, al.title ORDER BY plays DESC`,
    [from, to]
  );
  if (req.query.format === 'csv') {
    const lines = ['Faixa,Artistas,Compositores,Álbum,ISRC,Fonte,Reproduções'];
    for (const r of rows) lines.push([r.title, r.artists, r.composers, r.album, r.isrc, r.source === 'youtube' ? 'YouTube' : 'Própria', r.plays].map(csvEscape).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="reproducoes-${from}-a-${to}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}\r\n`);
  }
  res.json({ from, to, total: rows.reduce((s, r) => s + r.plays, 0), items: rows });
}));

// ---------------- Configurações e auditoria ----------------
adminRouter.get('/admin/settings', ah2(async (_req, res) => res.json(await getSettings())));
adminRouter.put('/admin/settings', ah2(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.offline_enabled !== undefined) patch.offline_enabled = !!b.offline_enabled;
  if (b.youtube_enabled !== undefined) patch.youtube_enabled = !!b.youtube_enabled;
  if (b.max_offline_devices !== undefined) patch.max_offline_devices = int(b.max_offline_devices, 'Aparelhos', { min: 1, max: 20, required: true });
  if (b.max_offline_tracks !== undefined) patch.max_offline_tracks = int(b.max_offline_tracks, 'Faixas offline', { min: 1, max: 10000, required: true });
  if (b.offline_license_days !== undefined) patch.offline_license_days = int(b.offline_license_days, 'Validade', { min: 1, max: 30, required: true });
  for (const [k, v] of Object.entries(patch)) {
    await q(`INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
  }
  await audit(req, 'admin.settings', 'settings', null, patch);
  res.json(await getSettings());
}));

adminRouter.get('/admin/audit', ah2(async (req, res) => {
  const before = req.query.before ? Number(req.query.before) : null;
  const rows = await q(
    `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.ip, l.created_at, u.display_name AS actor_name, u.email AS actor_email
       FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id WHERE ($1::bigint IS NULL OR l.id < $1) ORDER BY l.id DESC LIMIT 100`,
    [before]
  );
  res.json({ items: rows, next_before: rows.length === 100 ? rows[rows.length - 1].id : null });
}));
