import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { one, q } from '../db.js';
import { auth, encryptForDevice, unwrapKey, wrapKey } from '../security.js';
import { emit } from '../realtime.js';
import { getSettings } from '../seed.js';
import { ah, bad, forbidden, notFound, str, uuidList, uuidParam, uuidv7 } from '../util.js';
import { hydrateTracks } from '../views.js';
import { AUDIO_DIR } from './media.js';
import { ingestEvents } from './playback.js';

export const offlineRouter = express.Router();
offlineRouter.use(['/devices', '/offline'], auth());

offlineRouter.get('/devices', ah(async (req, res) => {
  const rows = await q(
    `SELECT d.id, d.name, d.platform, d.model, d.offline_enabled, d.created_at, d.last_seen_at,
            (SELECT count(*) FROM offline_licenses l WHERE l.device_id = d.id AND l.revoked_at IS NULL AND l.expires_at > now())::int AS licenses
       FROM devices d WHERE d.user_id = $1 AND d.revoked_at IS NULL ORDER BY d.last_seen_at DESC`,
    [req.user.id]
  );
  const s = await getSettings();
  res.json({ items: rows, max_devices: s.max_offline_devices, max_tracks: s.max_offline_tracks });
}));

offlineRouter.post('/devices', ah(async (req, res) => {
  const name = str(req.body?.name, 'Nome do aparelho', { required: true, max: 80 });
  const s = await getSettings();
  const { n } = await one(`SELECT count(*)::int AS n FROM devices WHERE user_id = $1 AND revoked_at IS NULL AND offline_enabled`, [req.user.id]);
  if (n >= s.max_offline_devices) {
    throw bad(`Limite de ${s.max_offline_devices} aparelhos com downloads atingido. Remova um aparelho em Configurações.`, 'DEVICE_LIMIT');
  }
  const id = uuidv7();
  await q(`INSERT INTO devices (id, user_id, platform, model, name) VALUES ($1,$2,$3,$4,$5)`, [
    id, req.user.id, str(req.body?.platform, 'platform', { max: 20 }) || 'web', str(req.body?.model, 'model', { max: 120 }), name,
  ]);
  res.status(201).json({ id, name });
}));

async function revokeDevice(userId, id) {
  const d = await one(`SELECT id FROM devices WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!d) throw notFound('Aparelho não encontrado');
  await q(`UPDATE devices SET revoked_at = now() WHERE id = $1`, [id]);
  await q(`UPDATE offline_licenses SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL`, [id]);
  await emit('download.revoked', { device_id: id }, [userId]);
}
offlineRouter.delete('/devices/:id', ah(async (req, res) => {
  await revokeDevice(req.user.id, uuidParam(req.params.id));
  res.json({ ok: true });
}));
offlineRouter.delete('/offline/devices/:id', ah(async (req, res) => {
  await revokeDevice(req.user.id, uuidParam(req.params.id));
  res.json({ ok: true });
}));

async function ownDevice(userId, deviceId) {
  const d = await one(`SELECT * FROM devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [deviceId, userId]);
  if (!d) throw forbidden('Aparelho não autorizado. Registre o aparelho de novo.', 'DEVICE_NOT_AUTHORIZED');
  await q(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [deviceId]);
  return d;
}

/** Licença offline (seção 4.1): chave de conteúdo por aparelho/faixa, validade de 30 dias. */
offlineRouter.post('/offline/licenses', ah(async (req, res) => {
  const s = await getSettings();
  if (!s.offline_enabled) throw forbidden('Downloads desativados pelo administrador', 'OFFLINE_DISABLED');
  const deviceId = uuidParam(req.body?.device_id, 'device_id');
  await ownDevice(req.user.id, deviceId);
  const trackIds = uuidList(req.body?.track_ids, 'track_ids', 100);
  const tracks = await hydrateTracks(trackIds, req.user);
  const ok = tracks.filter((t) => t.downloadable);
  const skipped = trackIds.filter((id) => !ok.find((t) => t.id === id));
  const { n } = await one(
    `SELECT count(DISTINCT track_id)::int AS n FROM offline_licenses WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       AND NOT (track_id = ANY($2::uuid[]))`,
    [req.user.id, ok.map((t) => t.id)]
  );
  if (n + ok.length > s.max_offline_tracks) throw bad(`Limite de ${s.max_offline_tracks} faixas baixadas por conta`, 'OFFLINE_LIMIT');
  const days = s.offline_license_days;
  const out = [];
  for (const t of ok) {
    const file = await one(`SELECT audio_size, audio_mime, checksum FROM tracks WHERE id = $1`, [t.id]);
    let lic = await one(
      `SELECT id, key_wrapped, expires_at FROM offline_licenses WHERE device_id = $1 AND track_id = $2 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY issued_at DESC LIMIT 1`,
      [deviceId, t.id]
    );
    if (lic) {
      lic = await one(`UPDATE offline_licenses SET expires_at = now() + ($2 || ' days')::interval WHERE id = $1 RETURNING id, key_wrapped, expires_at`, [lic.id, String(days)]);
    } else {
      const raw = crypto.randomBytes(32);
      lic = await one(
        `INSERT INTO offline_licenses (id, device_id, user_id, track_id, expires_at, key_wrapped)
         VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval, $6) RETURNING id, key_wrapped, expires_at`,
        [uuidv7(), deviceId, req.user.id, t.id, String(days), wrapKey(raw)]
      );
    }
    out.push({
      license_id: lic.id,
      track_id: t.id,
      key: unwrapKey(lic.key_wrapped).toString('base64'),
      expires_at: lic.expires_at,
      download_url: `offline/download/${lic.id}`,
      size: Number(file.audio_size) + 28,
      mime: file.audio_mime,
      checksum: file.checksum,
      track: t,
    });
  }
  res.json({ server_time: new Date().toISOString(), licenses: out, skipped });
}));

/** Arquivo cifrado com a chave da licença (AES-256-GCM). Só o aparelho com a chave consegue tocar. */
offlineRouter.get('/offline/download/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const lic = await one(
    `SELECT l.*, t.audio_path, t.status FROM offline_licenses l JOIN tracks t ON t.id = l.track_id
      WHERE l.id = $1 AND l.user_id = $2`,
    [id, req.user.id]
  );
  if (!lic || lic.revoked_at || lic.expires_at < new Date()) throw forbidden('Licença inválida ou expirada', 'LICENSE_INVALID');
  if (lic.status !== 'active' || !lic.audio_path) throw notFound('Faixa retirada do catálogo', 'TRACK_UNAVAILABLE');
  const file = path.join(AUDIO_DIR, path.basename(lic.audio_path));
  let data;
  try { data = await fs.promises.readFile(file); } catch { throw notFound('Arquivo de áudio não encontrado'); }
  const enc = encryptForDevice(unwrapKey(lic.key_wrapped), data);
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(enc.length), 'Cache-Control': 'no-store' });
  res.end(enc);
}));

/** Sincronização ao reconectar: renova licenças válidas, informa revogadas/retiradas e recebe eventos offline. */
offlineRouter.post('/offline/sync', ah(async (req, res) => {
  const deviceId = uuidParam(req.body?.device_id, 'device_id');
  const d = await one(`SELECT * FROM devices WHERE id = $1 AND user_id = $2`, [deviceId, req.user.id]);
  const licenseIds = Array.isArray(req.body?.license_ids) ? req.body.license_ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10000) : [];
  const accepted = Array.isArray(req.body?.events) && req.body.events.length ? await ingestEvents(req.user, req.body.events) : 0;
  if (!d || d.revoked_at) {
    return res.json({ server_time: new Date().toISOString(), device_revoked: true, valid: [], revoked: licenseIds, removed: [], events_accepted: accepted });
  }
  await q(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [deviceId]);
  const s = await getSettings();
  const rows = licenseIds.length
    ? await q(`SELECT l.id, l.track_id, l.revoked_at, l.expires_at, t.status FROM offline_licenses l JOIN tracks t ON t.id = l.track_id
                WHERE l.id = ANY($1::uuid[]) AND l.device_id = $2`, [licenseIds, deviceId])
    : [];
  const found = new Set(rows.map((r) => r.id));
  const valid = [];
  const revoked = licenseIds.filter((x) => !found.has(x));
  const removed = [];
  for (const r of rows) {
    if (r.status !== 'active') { removed.push(r.id); continue; }
    if (r.revoked_at || !s.offline_enabled) { revoked.push(r.id); continue; }
    const upd = await one(`UPDATE offline_licenses SET expires_at = now() + ($2 || ' days')::interval WHERE id = $1 RETURNING expires_at`, [r.id, String(s.offline_license_days)]);
    valid.push({ license_id: r.id, expires_at: upd.expires_at });
  }
  res.json({ server_time: new Date().toISOString(), device_revoked: false, valid, revoked, removed, events_accepted: accepted });
}));
