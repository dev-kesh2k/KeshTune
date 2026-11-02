import express from 'express';
import fs from 'fs';
import path from 'path';
import { one, q } from '../db.js';
import { auth, signStream, verifyStream } from '../security.js';
import { ah, bad, isUuid, notFound, oneOf, rateLimiter, uuidParam } from '../util.js';
import { AUDIO_DIR } from './media.js';

export const playbackRouter = express.Router();

const evLimit = rateLimiter({ windowMs: 60000, max: 120, key: (req) => req.user && `ev:${req.user.id}` });

playbackRouter.post('/playback/session', auth(), ah(async (req, res) => {
  const id = uuidParam(req.body?.track_id, 'track_id');
  const t = await one(`SELECT id, source, youtube_id, status, explicit FROM tracks WHERE id = $1`, [id]);
  if (!t) throw notFound('Faixa não encontrada', 'TRACK_NOT_FOUND');
  if (t.status !== 'active') throw bad('Faixa retirada do catálogo', 'TRACK_UNAVAILABLE');
  if (t.explicit && req.user.explicit_allowed === false) throw bad('Conteúdo explícito bloqueado nas suas configurações', 'EXPLICIT_BLOCKED');
  const s = signStream(id, req.user.id, 3600);
  if (t.source === 'youtube') {
    // O web toca pelo player incorporado (video_id); o app nativo toca a url, que o servidor repassa do YouTube
    return res.json({
      session_id: `ps_${Date.now().toString(36)}`, source: 'youtube', video_id: t.youtube_id, ads_before: false,
      url: `youtube/stream/${id}?u=${s.u}&exp=${s.exp}&sig=${s.sig}`, expires_at: new Date(s.exp * 1000).toISOString(),
    });
  }
  res.json({
    session_id: `ps_${Date.now().toString(36)}`,
    source: 'file',
    url: `stream/${id}?u=${s.u}&exp=${s.exp}&sig=${s.sig}`,
    expires_at: new Date(s.exp * 1000).toISOString(),
    ads_before: false,
  });
}));

/** Entrega o áudio com suporte a Range (o <audio> busca por partes); URL assinada válida por 1 h. */
playbackRouter.get('/stream/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  if (!verifyStream(id, req.query)) return res.status(403).json({ error: { code: 'URL_EXPIRED', message: 'Link de reprodução expirado' } });
  const t = await one(
    `SELECT t.audio_path, t.audio_mime, t.status FROM tracks t JOIN users u ON u.id = $2 AND u.status = 'active' AND u.deleted_at IS NULL WHERE t.id = $1`,
    [id, req.query.u]
  );
  if (!t || t.status !== 'active' || !t.audio_path) throw notFound('Áudio indisponível');
  const file = path.join(AUDIO_DIR, path.basename(t.audio_path));
  let stat;
  try { stat = fs.statSync(file); } catch { throw notFound('Arquivo de áudio não encontrado'); }
  res.set({ 'Content-Type': t.audio_mime || 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    if (!range[1] && !range[2]) { start = 0; end = stat.size - 1; }
    end = Math.min(end, stat.size - 1);
    if (start < 0 || start > end) {
      res.set('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.set('Content-Length', String(stat.size));
    fs.createReadStream(file).pipe(res);
  }
}));

/** Grava eventos de escuta (online ou enviados em lote depois do modo offline). */
export async function ingestEvents(user, events) {
  let accepted = 0;
  for (const e of events.slice(0, 500)) {
    if (!e || !isUuid(e.track_id)) continue;
    const type = oneOf(e.event, 'event', ['start', 'end', 'skip', 'error', 'duration'], 'end');
    if (type === 'duration') {
      const d = Number(e.duration_ms);
      if (d > 0 && d < 6 * 3600 * 1000) await q(`UPDATE tracks SET duration_ms = $2 WHERE id = $1 AND source = 'youtube' AND duration_ms = 0`, [e.track_id, Math.round(d)]);
      continue;
    }
    if (type === 'start' || type === 'error') continue;
    const ms = Math.max(0, Math.min(Number(e.ms_played) || 0, 6 * 3600 * 1000));
    const playedAt = e.played_at && !Number.isNaN(Date.parse(e.played_at)) && Date.parse(e.played_at) <= Date.now() + 60000
      ? new Date(Math.max(Date.parse(e.played_at), Date.now() - 45 * 86400000)) : new Date();
    const exists = await one(`SELECT id FROM tracks WHERE id = $1`, [e.track_id]);
    if (!exists) continue;
    await q(
      `INSERT INTO play_history (user_id, track_id, device_id, ms_played, event, context_type, context_id, offline, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user.id, e.track_id, isUuid(e.device_id) ? e.device_id : null, ms, type, String(e.context_type || '').slice(0, 12) || null,
        String(e.context_id || '').slice(0, 64) || null, !!e.offline, playedAt]
    );
    // conta como reprodução (royalties/ranking) quando ouviu 30 s ou mais
    if (ms >= 30000) {
      await q(
        `INSERT INTO play_counts (track_id, day, plays) VALUES ($1, ($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, 1)
         ON CONFLICT (track_id, day) DO UPDATE SET plays = play_counts.plays + 1`,
        [e.track_id, playedAt]
      );
      await q(`UPDATE tracks SET popularity = popularity + 1 WHERE id = $1`, [e.track_id]);
    }
    accepted += 1;
  }
  return accepted;
}

playbackRouter.post('/playback/events', auth(), evLimit, ah(async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!events.length) throw bad('Envie events[]');
  res.json({ accepted: await ingestEvents(req.user, events) });
}));
